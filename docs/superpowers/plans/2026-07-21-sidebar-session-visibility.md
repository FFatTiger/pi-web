# Sidebar Session Visibility Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit each project's default session list to five recent ordinary sessions while always showing running, unread, and currently open sessions; preserve the open chat when workspace context changes; add subtle project/session row contrast.

**Architecture:** Keep all selection policy in a pure helper in `lib/sidebar-projects.ts`, returning an activity-prioritized filtered fork tree plus hidden count. `SessionSidebar` owns only per-project “show all” UI state and rendering. `AppShell` treats project/worktree changes as workspace-context updates only; explicit session/new-session handlers remain the sole owners of main-chat replacement.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, CSS custom properties, PM2 development runtime.

## Global Constraints

- Default ordinary-session limit is exactly **5 per project**.
- Running, unread, and currently open sessions are always visible and do not consume the five slots.
- Ordinary sessions older than exactly three days are hidden by default and do not consume a slot.
- Required available ancestor chains are visible and do not consume ordinary slots.
- Priority is running, unread, current, then ordinary; each category is ordered by `modified` descending.
- Project-row and Worktree selection preserve the open chat and `?session=` URL.
- Session click, project `+`, and current-session deletion retain explicit main-window replacement behavior.
- “Show all” state is per project and page-lifetime only.
- No API, server, session-file, SSE, persistence-format, search, virtualization, or build changes.
- Never run `next build`; use Node tests, `tsc --noEmit`, ESLint, PM2 restart, HTTP and HMR checks.

---

### Task 1: Add the Pure Default-Visibility Policy

**Files:**
- Modify: `lib/sidebar-projects.ts`
- Modify: `lib/sidebar-projects.test.mjs`

**Interfaces:**
- Consumes: existing `SessionInfo`, `SidebarSessionTreeNode`, and `buildSidebarSessionTree(sessions)`.
- Produces:

```ts
export interface SidebarSessionVisibilityOptions {
  runningSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  selectedSessionId: string | null;
  nowMs?: number;
  ordinaryLimit?: number;
  recentWindowMs?: number;
}

export interface SidebarSessionVisibility {
  tree: SidebarSessionTreeNode[];
  hiddenCount: number;
}

export function getSidebarSessionVisibility(
  sessions: SessionInfo[],
  options: SidebarSessionVisibilityOptions,
): SidebarSessionVisibility;
```

- [ ] **Step 1: Add failing tests for the five-session budget and three-day cutoff**

Append tests using a fixed `nowMs = Date.parse("2026-07-21T12:00:00.000Z")`. Create seven recent ordinary sessions and two old sessions. Assert that the default tree contains exactly the five newest recent IDs, excludes old ordinary IDs, orders visible ordinary roots by `modified` descending, and reports four hidden sessions.

```js
test("shows at most five recent ordinary sessions and hides sessions older than three days", async () => {
  const { getSidebarSessionVisibility } = await loadSubject();
  const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
  const sessions = [
    ...Array.from({ length: 7 }, (_, index) => session({
      id: `recent-${index}`,
      modified: new Date(nowMs - index * 60_000).toISOString(),
    })),
    session({ id: "old-1", modified: "2026-07-18T11:59:59.999Z" }),
    session({ id: "old-2", modified: "invalid" }),
  ];

  const result = getSidebarSessionVisibility(sessions, {
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    selectedSessionId: null,
    nowMs,
  });

  assert.deepEqual(result.tree.map((node) => node.session.id), [
    "recent-0", "recent-1", "recent-2", "recent-3", "recent-4",
  ]);
  assert.equal(result.hiddenCount, 4);
});
```

- [ ] **Step 2: Add failing tests for status sessions, de-duplication, and priority order**

Create more than five eligible ordinary sessions plus old running/unread/current sessions. Include one ID in all three special sets to prove de-duplication. Assert all special sessions appear before ordinary sessions, old special sessions remain visible, and five ordinary sessions still appear.

```js
test("shows status sessions outside the ordinary budget in priority and modified order", async () => {
  const { getSidebarSessionVisibility } = await loadSubject();
  const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
  const ordinary = Array.from({ length: 6 }, (_, index) => session({
    id: `ordinary-${index}`,
    modified: new Date(nowMs - index * 60_000).toISOString(),
  }));
  const sessions = [
    ...ordinary,
    session({ id: "running-new", modified: "2026-07-17T12:00:00.000Z" }),
    session({ id: "running-old", modified: "2026-07-16T12:00:00.000Z" }),
    session({ id: "unread", modified: "2026-07-15T12:00:00.000Z" }),
    session({ id: "current", modified: "2026-07-14T12:00:00.000Z" }),
  ];

  const result = getSidebarSessionVisibility(sessions, {
    runningSessionIds: new Set(["running-old", "running-new", "unread"]),
    unreadSessionIds: new Set(["unread", "current"]),
    selectedSessionId: "current",
    nowMs,
  });
  const ids = result.tree.map((node) => node.session.id);

  assert.deepEqual(ids.slice(0, 4), ["running-new", "running-old", "unread", "current"]);
  assert.deepEqual(ids.slice(4), ["ordinary-0", "ordinary-1", "ordinary-2", "ordinary-3", "ordinary-4"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(result.hiddenCount, 1);
});
```

- [ ] **Step 3: Add a failing test for ancestor-chain inclusion and subtree priority**

Create an old root, old child, and running leaf, plus five recent ordinary roots and one hidden ordinary root. Assert the entire root → child → leaf chain is included without reducing the five ordinary slots, and its root subtree sorts before ordinary roots.

```js
test("includes required ancestors without consuming ordinary slots", async () => {
  const { getSidebarSessionVisibility } = await loadSubject();
  const nowMs = Date.parse("2026-07-21T12:00:00.000Z");
  const sessions = [
    session({ id: "ancestor", modified: "2026-07-10T10:00:00.000Z" }),
    session({ id: "parent", parentSessionId: "ancestor", modified: "2026-07-11T10:00:00.000Z" }),
    session({ id: "active-leaf", parentSessionId: "parent", modified: "2026-07-12T10:00:00.000Z" }),
    ...Array.from({ length: 6 }, (_, index) => session({
      id: `ordinary-${index}`,
      modified: new Date(nowMs - index * 60_000).toISOString(),
    })),
  ];

  const result = getSidebarSessionVisibility(sessions, {
    runningSessionIds: new Set(["active-leaf"]),
    unreadSessionIds: new Set(),
    selectedSessionId: null,
    nowMs,
  });

  assert.equal(result.tree[0].session.id, "ancestor");
  assert.equal(result.tree[0].children[0].session.id, "parent");
  assert.equal(result.tree[0].children[0].children[0].session.id, "active-leaf");
  assert.deepEqual(result.tree.slice(1).map((node) => node.session.id), [
    "ordinary-0", "ordinary-1", "ordinary-2", "ordinary-3", "ordinary-4",
  ]);
  assert.equal(result.hiddenCount, 1);
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
```

Expected: existing seven tests pass; new tests fail because `getSidebarSessionVisibility` is missing.

- [ ] **Step 5: Implement the visibility helper minimally**

Add constants, exported interfaces, category classification, cutoff filtering, ancestor inclusion, and activity-aware subtree sorting. Use these exact policy values unless callers override them:

```ts
const DEFAULT_ORDINARY_SESSION_LIMIT = 5;
const DEFAULT_RECENT_SESSION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
```

Implementation requirements:

1. Parse `modified` with `Date.parse`; invalid timestamps sort as oldest and fail ordinary recency eligibility.
2. Assign direct priority `0` running, `1` unread, `2` selected, `3` ordinary.
3. Select every priority 0–2 session.
4. Select the first `ordinaryLimit` priority-3 sessions whose parsed time is at least `nowMs - recentWindowMs`.
5. Walk `parentSessionId` through sessions available in `sessions`, adding all available ancestors.
6. Build the filtered tree with `buildSidebarSessionTree`.
7. Recursively derive each node's best subtree priority and newest timestamp at that priority; sort siblings by best priority ascending, then that timestamp descending, then the node timestamp descending, then ID.
8. Return `sessions.length - visibleIds.size` as `hiddenCount`.
9. Never mutate inputs or caller sets.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all sidebar-project tests pass and TypeScript exits 0.

- [ ] **Step 7: Commit Task 1**

```bash
git add lib/sidebar-projects.ts lib/sidebar-projects.test.mjs
git commit -m "feat: limit default project session visibility"
```

---

### Task 2: Integrate Per-Project Show-All State and Row Contrast

**Files:**
- Modify: `components/SessionSidebar.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `getSidebarSessionVisibility(sessions, options)` from Task 1.
- Produces: page-lifetime `showAllSessionProjects: Set<string>`, `ProjectGroup` props for complete/default trees, hidden count, and toggle callback.

- [ ] **Step 1: Import the visibility helper and add page-lifetime state**

Add `getSidebarSessionVisibility` to the existing imports and add:

```ts
const [showAllSessionProjects, setShowAllSessionProjects] = useState<Set<string>>(() => new Set());
```

Add a stable toggle:

```ts
const toggleShowAllSessions = useCallback((projectRoot: string) => {
  setShowAllSessionProjects((previous) => {
    const next = new Set(previous);
    if (next.has(projectRoot)) next.delete(projectRoot);
    else next.add(projectRoot);
    return next;
  });
}, []);
```

- [ ] **Step 2: Compute complete and default trees per project**

Inside `projectGroups.map`, compute:

```ts
const fullTree = buildSidebarSessionTree(group.sessions);
const visibility = getSidebarSessionVisibility(group.sessions, {
  runningSessionIds,
  unreadSessionIds,
  selectedSessionId,
});
const showAllSessions = showAllSessionProjects.has(group.root);
```

Pass `tree={showAllSessions ? fullTree : visibility.tree}`, `hiddenCount={visibility.hiddenCount}`, `showAllSessions`, and `onToggleShowAllSessions={() => toggleShowAllSessions(group.root)}` to `ProjectGroup`.

- [ ] **Step 3: Render Show all / Show less below the project tree**

Extend `ProjectGroup` props with:

```ts
hiddenCount: number;
showAllSessions: boolean;
onToggleShowAllSessions: () => void;
```

When the project is expanded, render the chosen tree and then render this control whenever `hiddenCount > 0`:

```tsx
<button
  type="button"
  onClick={(event) => {
    event.stopPropagation();
    onToggleShowAllSessions();
  }}
  aria-expanded={showAllSessions}
  style={{
    width: "100%",
    height: 30,
    padding: "0 14px 0 28px",
    display: "flex",
    alignItems: "center",
    background: "transparent",
    border: "none",
    color: "var(--text-dim)",
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  }}
>
  {showAllSessions ? "Show less" : `Show all (${hiddenCount})`}
</button>
```

Preserve the existing `No sessions yet` state for truly empty projects.

- [ ] **Step 4: Add semantic project-row background tokens**

Add to `:root` and `html.dark`:

```css
:root {
  --project-row-bg: #eef1f4;
}

html.dark {
  --project-row-bg: #292929;
}
```

Use it only as the ProjectGroup default background:

```ts
background: selected
  ? "var(--bg-selected)"
  : hovered
    ? "var(--bg-hover)"
    : "var(--project-row-bg)",
```

Session rows remain transparent by default. Keep existing selected and hover colors authoritative.

- [ ] **Step 5: Validate Task 2**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
```

Expected: tests pass; TypeScript and ESLint exit 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add components/SessionSidebar.tsx app/globals.css
git commit -m "feat: add compact expandable project session lists"
```

---

### Task 3: Preserve Main-Window Content Across Workspace Selection

**Files:**
- Create: `components/AppShell.workspace.test.mjs`
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: existing `activateWorkspace`, `handleSelectProject`, `handleNewSession`, and `effectiveNewSessionCwd` state flow.
- Produces: workspace activation that only updates `activeCwd`, `activeProjectRoot`, and `projectCwds`; explicit session/new-session handlers continue to own chat replacement.

- [ ] **Step 1: Write a failing source-level regression test**

Create `components/AppShell.workspace.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const activationStart = source.indexOf("const activateWorkspace");
const activationEnd = source.indexOf("const handleSelectProject", activationStart);
const activationBlock = source.slice(activationStart, activationEnd);

test("workspace selection preserves the open chat and session URL", () => {
  assert.ok(activationStart >= 0 && activationEnd > activationStart);
  assert.doesNotMatch(activationBlock, /setSelectedSession\s*\(/);
  assert.doesNotMatch(activationBlock, /setNewSessionCwd\s*\(/);
  assert.doesNotMatch(activationBlock, /setSessionKey\s*\(/);
  assert.doesNotMatch(activationBlock, /router\.replace\s*\(/);
});

test("workspace selection alone does not synthesize a new-session input", () => {
  assert.match(source, /const effectiveNewSessionCwd = newSessionCwd;/);
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
node --test components/AppShell.workspace.test.mjs
```

Expected: both tests fail against the current workspace-clearing and implicit-new-session code.

- [ ] **Step 3: Make workspace activation context-only**

Replace the body after `projectCwds` update by ending the callback immediately. The completed callback must have this behavior:

```ts
const activateWorkspace = useCallback((cwd: string | null, projectRoot?: string | null) => {
  const nextProject = projectRoot ?? cwd;
  setActiveCwd(cwd);
  setActiveProjectRoot(nextProject);
  if (cwd && nextProject) {
    setProjectCwds((previous) => {
      const next = new Map(previous);
      next.set(nextProject, cwd);
      return next;
    });
  }
}, []);
```

Remove the obsolete comments and dependencies concerning foreign-session closure. Keep `handleNewSession`, `handleSelectSession`, and `handleSessionDeleted` unchanged so explicit navigation still replaces main-window state.

- [ ] **Step 4: Require explicit new-session state**

Change:

```ts
const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
```

to:

```ts
const effectiveNewSessionCwd = newSessionCwd;
```

Update the nearby comment to state that chat appears only for a selected session or an explicitly requested new session. Keep `handleNewSession` responsible for setting `newSessionCwd`.

Update the stale hydration comment so it describes filling server-computed metadata on transient new/fork sessions without claiming `activateWorkspace` needs `projectRoot` to preserve the chat.

- [ ] **Step 5: Verify Task 3 and all static gates**

Run:

```bash
node --test components/AppShell.workspace.test.mjs
node --test next-config.test.mjs components/*.test.mjs lib/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
```

Expected: workspace regression tests pass, complete Node suite has zero failures, TypeScript and ESLint exit 0.

- [ ] **Step 6: Commit Task 3**

```bash
git add components/AppShell.tsx components/AppShell.workspace.test.mjs
git commit -m "fix: preserve chat while selecting workspaces"
```

---

### Task 4: Final Runtime and Regression Verification

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: completed Tasks 1–3 and PM2 process `pi-web`.
- Produces: verification evidence for tests, runtime, HMR, and repository cleanliness.

- [ ] **Step 1: Run complete verification from the feature worktree**

```bash
node --test next-config.test.mjs components/*.test.mjs lib/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
git status --short
```

Expected: all tests pass, TypeScript and ESLint exit 0, `git diff --check` exits 0, worktree is clean.

- [ ] **Step 2: Restart and save the PM2 development instance**

```bash
pm2 restart pi-web
pm2 save
```

Expected: `pi-web` returns to `online` using cwd `/Users/proxy/Documents/program/pi-web/.worktrees/sidebar-multi-project`.

- [ ] **Step 3: Verify HTTP and HMR WebSocket boundaries**

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30141/
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30141/api/sessions
curl --http1.1 -sS -i -N --max-time 2 \
  -H 'Host: pi.huu.im' \
  -H 'Origin: https://pi.huu.im' \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://127.0.0.1:30141/_next/webpack-hmr
```

Expected: homepage 200, sessions API 200, HMR handshake begins with `HTTP/1.1 101 Switching Protocols`; curl timeout after receiving WebSocket frames is expected.

- [ ] **Step 4: Inspect decisive runtime state**

```bash
pm2 describe pi-web
git log -6 --oneline
```

Expected: PM2 online in the feature worktree and commits for visibility policy, compact UI, and workspace preservation present.
