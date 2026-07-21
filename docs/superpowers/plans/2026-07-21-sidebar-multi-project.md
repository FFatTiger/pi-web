# Multi-Project Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-project sidebar with a persistent multi-project session tree, move Worktree management into the chat top bar, and move the file explorer into the existing mutually-exclusive right panel.

**Architecture:** Keep the existing running-session SSE unchanged and aggregate activity in a new pure `lib/sidebar-projects.ts` module. `SessionSidebar` owns session loading, unread state, manual projects, and project expansion; `AppShell` owns the active project/cwd, per-project Worktree choice, file tabs, and right-panel mode. New `WorktreeSwitcher` and `WorkspaceFilePanel` components isolate the two UI areas currently embedded in `SessionSidebar` and `AppShell`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, inline component styles plus `app/globals.css`, Node `node:test`, Jiti for TypeScript test imports, PM2 for the development process.

## Global Constraints

- Do not change `/api/agent/running/events` or `lib/rpc-manager.ts`; continue consuming `{ runningSessionIds }`.
- Do not add host, CPU/RAM, project/session search, running counts, running-project pinning, or automatic expansion.
- Project activity priority is exactly `running > unread > idle`.
- Multiple project groups may be expanded and their state must persist in `pi-web:expanded-projects`.
- Manual empty projects must persist in `pi-web:manual-projects` and merge with session-backed projects by exact normalized project root.
- Worktree selection is page-lifetime state per project and is not persisted to localStorage.
- Explorer and file detail are mutually exclusive modes of one right panel.
- Preserve session fork trees, rename/delete, uploads, refresh, `@` mentions, file tabs, and mobile behavior.
- Never run `next build`; validate with TypeScript, ESLint, targeted Node tests, and the existing test suite.
- Keep the PM2 application name `pi-web` and port `30141`; the verification instance must run this repository with `npm run dev -- --hostname 0.0.0.0`.

---

## File Structure

- Create `lib/sidebar-projects.ts`: pure project grouping, activity aggregation, ordering, manual-project parsing/serialization, expanded-project parsing/serialization, and session-fork tree construction.
- Create `lib/sidebar-projects.test.mjs`: Node tests for every pure state transition and ordering rule.
- Create `components/WorktreeSwitcher.tsx`: top-bar Worktree listing, selection, creation, removal, dirty confirmation, and disabled/error states.
- Create `components/WorkspaceFilePanel.tsx`: shared explorer/file-viewer right-panel body and explorer toolbar.
- Modify `components/SessionSidebar.tsx`: render all project groups, persist expansion/manual projects, aggregate running/unread state, and retain session-row operations.
- Modify `components/AppShell.tsx`: own active project/cwd, per-project cwd choices, top-bar Worktree control, right-panel mode, and two right-corner buttons.
- Modify `app/globals.css`: right-panel/mobile behavior and reduced-motion support for project activity indicators if needed.
- Modify `docs/superpowers/specs/2026-07-21-sidebar-multi-project-design.md` only if implementation uncovers a genuine contradiction; do not silently change approved behavior.

---

### Task 1: Add Project Grouping and Persistence Primitives

**Files:**
- Create: `lib/sidebar-projects.ts`
- Create: `lib/sidebar-projects.test.mjs`

**Interfaces:**
- Consumes: `SessionInfo` from `lib/types.ts`.
- Produces:

```ts
export type ProjectActivity = "running" | "unread" | "idle";

export interface ManualProject {
  root: string;
  lastOpened: string;
}

export interface SidebarProjectGroup {
  root: string;
  sessions: SessionInfo[];
  latestActivity: string;
  manual: boolean;
}

export interface SidebarSessionTreeNode {
  session: SessionInfo;
  children: SidebarSessionTreeNode[];
}

export function groupSidebarProjects(
  sessions: SessionInfo[],
  manualProjects: ManualProject[],
): SidebarProjectGroup[];

export function getProjectActivity(
  sessions: SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): ProjectActivity;

export function buildSidebarSessionTree(
  sessions: SessionInfo[],
): SidebarSessionTreeNode[];

export function parseManualProjects(raw: string | null): ManualProject[];
export function serializeManualProjects(projects: ManualProject[]): string;
export function upsertManualProject(
  projects: ManualProject[],
  root: string,
  lastOpened: string,
): ManualProject[];
export function parseExpandedProjects(raw: string | null): Set<string>;
export function serializeExpandedProjects(projects: ReadonlySet<string>): string;
```

- [ ] **Step 1: Write the failing grouping and activity tests**

Create `lib/sidebar-projects.test.mjs` with exact session fixtures and assertions:

```js
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./sidebar-projects.ts");
}

function session(overrides = {}) {
  return {
    path: "/sessions/base.jsonl",
    id: "base",
    cwd: "/repos/base",
    projectRoot: "/repos/base",
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "base",
    ...overrides,
  };
}

test("groups linked worktrees by project root and sorts by latest session activity", async () => {
  const { groupSidebarProjects } = await loadSubject();
  const groups = groupSidebarProjects([
    session({ id: "a-main", cwd: "/repos/a", projectRoot: "/repos/a", modified: "2026-07-20T09:00:00.000Z" }),
    session({ id: "a-wt", cwd: "/repos/a-worktrees/feature", projectRoot: "/repos/a", modified: "2026-07-20T11:00:00.000Z" }),
    session({ id: "b", cwd: "/repos/b", projectRoot: "/repos/b", modified: "2026-07-20T10:00:00.000Z" }),
  ], []);

  assert.deepEqual(groups.map((group) => group.root), ["/repos/a", "/repos/b"]);
  assert.deepEqual(groups[0].sessions.map((item) => item.id), ["a-wt", "a-main"]);
  assert.equal(groups[0].latestActivity, "2026-07-20T11:00:00.000Z");
});

test("deduplicates manual projects against session-backed projects", async () => {
  const { groupSidebarProjects } = await loadSubject();
  const groups = groupSidebarProjects(
    [session({ id: "a", cwd: "/repos/a", projectRoot: "/repos/a" })],
    [
      { root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" },
      { root: "/repos/empty", lastOpened: "2026-07-21T11:00:00.000Z" },
    ],
  );

  assert.deepEqual(groups.map((group) => [group.root, group.manual, group.sessions.length]), [
    ["/repos/empty", true, 0],
    ["/repos/a", true, 1],
  ]);
});

test("reports running before unread and unread before idle", async () => {
  const { getProjectActivity } = await loadSubject();
  const sessions = [session({ id: "one" }), session({ id: "two" })];

  assert.equal(getProjectActivity(sessions, new Set(["one"]), new Set(["two"])), "running");
  assert.equal(getProjectActivity(sessions, new Set(), new Set(["two"])), "unread");
  assert.equal(getProjectActivity(sessions, new Set(), new Set()), "idle");
});

test("does not reorder projects when only external activity sets change", async () => {
  const { groupSidebarProjects, getProjectActivity } = await loadSubject();
  const groups = groupSidebarProjects([
    session({ id: "newer", projectRoot: "/repos/newer", cwd: "/repos/newer", modified: "2026-07-21T12:00:00.000Z" }),
    session({ id: "older", projectRoot: "/repos/older", cwd: "/repos/older", modified: "2026-07-21T11:00:00.000Z" }),
  ], []);

  assert.deepEqual(groups.map((group) => group.root), ["/repos/newer", "/repos/older"]);
  assert.equal(getProjectActivity(groups[1].sessions, new Set(["older"]), new Set()), "running");
  assert.deepEqual(groups.map((group) => group.root), ["/repos/newer", "/repos/older"]);
});
```

- [ ] **Step 2: Write the failing persistence and fork-tree tests**

Append:

```js
test("round-trips manual projects and removes malformed entries", async () => {
  const { parseManualProjects, serializeManualProjects, upsertManualProject } = await loadSubject();
  const parsed = parseManualProjects(JSON.stringify([
    { root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" },
    { root: 42, lastOpened: "bad" },
    null,
  ]));

  assert.deepEqual(parsed, [{ root: "/repos/a", lastOpened: "2026-07-21T12:00:00.000Z" }]);
  assert.deepEqual(parseManualProjects("not json"), []);
  assert.deepEqual(
    upsertManualProject(parsed, "/repos/a", "2026-07-21T13:00:00.000Z"),
    [{ root: "/repos/a", lastOpened: "2026-07-21T13:00:00.000Z" }],
  );
  assert.equal(
    serializeManualProjects(parsed),
    '[{"root":"/repos/a","lastOpened":"2026-07-21T12:00:00.000Z"}]',
  );
});

test("round-trips expanded projects and falls back for damaged data", async () => {
  const { parseExpandedProjects, serializeExpandedProjects } = await loadSubject();
  assert.deepEqual([...parseExpandedProjects('["/repos/b","/repos/a","/repos/a"]')], ["/repos/b", "/repos/a"]);
  assert.deepEqual([...parseExpandedProjects("not json")], []);
  assert.equal(serializeExpandedProjects(new Set(["/repos/b", "/repos/a"])), '["/repos/b","/repos/a"]');
});

test("builds fork trees and resolves through missing ancestors", async () => {
  const { buildSidebarSessionTree } = await loadSubject();
  const tree = buildSidebarSessionTree([
    session({ id: "root", modified: "2026-07-21T10:00:00.000Z" }),
    session({ id: "missing-child", parentSessionId: "missing", modified: "2026-07-21T12:00:00.000Z" }),
    session({ id: "leaf", parentSessionId: "missing-child", modified: "2026-07-21T13:00:00.000Z" }),
    session({ id: "child", parentSessionId: "root", modified: "2026-07-21T11:00:00.000Z" }),
  ]);

  assert.deepEqual(tree.map((node) => node.session.id), ["missing-child", "root"]);
  assert.deepEqual(tree[0].children.map((node) => node.session.id), ["leaf"]);
  assert.deepEqual(tree[1].children.map((node) => node.session.id), ["child"]);
});
```

- [ ] **Step 3: Run the new tests and verify failure**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/sidebar-projects.ts`.

- [ ] **Step 4: Implement the pure module**

Create `lib/sidebar-projects.ts` with these implementations:

```ts
import type { SessionInfo } from "./types";

export type ProjectActivity = "running" | "unread" | "idle";

export interface ManualProject {
  root: string;
  lastOpened: string;
}

export interface SidebarProjectGroup {
  root: string;
  sessions: SessionInfo[];
  latestActivity: string;
  manual: boolean;
}

export interface SidebarSessionTreeNode {
  session: SessionInfo;
  children: SidebarSessionTreeNode[];
}

export function groupSidebarProjects(
  sessions: SessionInfo[],
  manualProjects: ManualProject[],
): SidebarProjectGroup[] {
  const manualByRoot = new Map(manualProjects.map((project) => [project.root, project]));
  const groups = new Map<string, SidebarProjectGroup>();

  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    const existing = groups.get(root);
    if (existing) {
      existing.sessions.push(session);
      if (session.modified > existing.latestActivity) existing.latestActivity = session.modified;
    } else {
      groups.set(root, {
        root,
        sessions: [session],
        latestActivity: session.modified,
        manual: manualByRoot.has(root),
      });
    }
  }

  for (const project of manualProjects) {
    const existing = groups.get(project.root);
    if (existing) {
      existing.manual = true;
      continue;
    }
    groups.set(project.root, {
      root: project.root,
      sessions: [],
      latestActivity: project.lastOpened,
      manual: true,
    });
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  return [...groups.values()].sort((a, b) => b.latestActivity.localeCompare(a.latestActivity));
}

export function getProjectActivity(
  sessions: SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): ProjectActivity {
  if (sessions.some((session) => runningSessionIds.has(session.id))) return "running";
  if (sessions.some((session) => unreadSessionIds.has(session.id))) return "unread";
  return "idle";
}

export function buildSidebarSessionTree(sessions: SessionInfo[]): SidebarSessionTreeNode[] {
  const byId = new Map<string, SidebarSessionTreeNode>();
  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    byId.set(session.id, { session, children: [] });
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  const resolveAncestor = (id: string): string | null => {
    let current = parentOf.get(id);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (byId.has(current)) return current;
      current = parentOf.get(current);
    }
    return null;
  };

  const roots: SidebarSessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: SidebarSessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function parseManualProjects(raw: string | null): ManualProject[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ManualProject => Boolean(
      value
      && typeof value === "object"
      && typeof (value as ManualProject).root === "string"
      && typeof (value as ManualProject).lastOpened === "string",
    ));
  } catch {
    return [];
  }
}

export function serializeManualProjects(projects: ManualProject[]): string {
  return JSON.stringify(projects);
}

export function upsertManualProject(
  projects: ManualProject[],
  root: string,
  lastOpened: string,
): ManualProject[] {
  return [{ root, lastOpened }, ...projects.filter((project) => project.root !== root)];
}

export function parseExpandedProjects(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function serializeExpandedProjects(projects: ReadonlySet<string>): string {
  return JSON.stringify([...projects]);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all sidebar-project tests PASS; TypeScript exits 0.

- [ ] **Step 6: Commit the primitive layer**

```bash
git add lib/sidebar-projects.ts lib/sidebar-projects.test.mjs
git commit -m "feat: add sidebar project grouping primitives"
```

---

### Task 2: Extract the Top-Bar Worktree Switcher

**Files:**
- Create: `components/WorktreeSwitcher.tsx`
- Reference while migrating: `components/SessionSidebar.tsx:31-46,336-346,499-528,625-690,1142-1458`
- Reference API: `app/api/worktrees/route.ts:1-91`

**Interfaces:**
- Consumes:

```ts
interface WorktreeSwitcherProps {
  projectRoot: string | null;
  cwd: string | null;
  onCwdChange: (cwd: string, projectRoot: string) => void;
}
```

- Produces: a self-contained top-bar button/dropdown with existing create/remove semantics.
- GET response: `{ projectRoot, isGit, isTopLevel, worktrees }`.
- POST body: `{ cwd: projectRoot, branch }`; response `{ path, branch }`.
- DELETE body: `{ cwd: projectRoot, path, force }`; dirty response is HTTP 409 with `{ dirty: true }`.

- [ ] **Step 1: Create the component shell and exact state model**

Create `components/WorktreeSwitcher.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeResponse {
  projectRoot?: string;
  isGit?: boolean;
  isTopLevel?: boolean;
  worktrees?: WorktreeEntry[];
  error?: string;
}

interface WorktreeSwitcherProps {
  projectRoot: string | null;
  cwd: string | null;
  onCwdChange: (cwd: string, projectRoot: string) => void;
}

export function WorktreeSwitcher({ projectRoot, cwd, onCwdChange }: WorktreeSwitcherProps) {
  const [data, setData] = useState<WorktreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  return null;
}
```

This first step deliberately renders nothing; the completed fetch, mutation, and dropdown rendering replace `return null` before the task's validation and commit.

- [ ] **Step 2: Migrate fetching and stale-response protection**

Implement this effect, resetting project-specific transient state whenever the active context changes:

```tsx
useEffect(() => {
  setOpen(false);
  setNewOpen(false);
  setBranch("");
  setError(null);
  setConfirmRemove(null);
}, [projectRoot]);

useLayoutEffect(() => {
  if (!cwd || !projectRoot) {
    setData(null);
    setLoading(false);
    return;
  }
  let cancelled = false;
  setLoading(true);
  fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`)
    .then(async (response) => {
      const body = await response.json() as WorktreeResponse;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      return body;
    })
    .then((body) => {
      if (!cancelled) setData(body);
    })
    .catch((failure) => {
      if (!cancelled) {
        setData(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
  return () => { cancelled = true; };
}, [cwd, projectRoot, refreshKey]);
```

- [ ] **Step 3: Migrate create and remove handlers**

Use the approved callbacks and preserve the current dirty confirmation behavior:

```tsx
const createWorktree = useCallback(async () => {
  const nextBranch = branch.trim();
  if (!nextBranch || busy || !projectRoot) return;
  setBusy(true);
  setError(null);
  try {
    const response = await fetch("/api/worktrees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: projectRoot, branch: nextBranch }),
    });
    const body = await response.json().catch(() => ({})) as { path?: string; error?: string };
    if (!response.ok || !body.path) throw new Error(body.error ?? `HTTP ${response.status}`);
    setBranch("");
    setNewOpen(false);
    setOpen(false);
    onCwdChange(body.path, projectRoot);
    setRefreshKey((value) => value + 1);
  } catch (failure) {
    setError(failure instanceof Error ? failure.message : String(failure));
  } finally {
    setBusy(false);
  }
}, [branch, busy, onCwdChange, projectRoot]);

const removeWorktree = useCallback(async (path: string, force: boolean) => {
  if (busy || !projectRoot) return;
  setBusy(true);
  setError(null);
  try {
    const response = await fetch("/api/worktrees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: projectRoot, path, force }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; dirty?: boolean };
    if (!response.ok) {
      if (body.dirty && !force) {
        setConfirmRemove(path);
        return;
      }
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    setConfirmRemove(null);
    if (cwd === path) onCwdChange(projectRoot, projectRoot);
    setRefreshKey((value) => value + 1);
  } catch (failure) {
    setError(failure instanceof Error ? failure.message : String(failure));
  } finally {
    setBusy(false);
  }
}, [busy, cwd, onCwdChange, projectRoot]);
```

- [ ] **Step 4: Migrate the existing dropdown UI into top-bar dimensions**

Render one 36px-high top-bar control. Use these exact enabled-state rules:

```tsx
const enabled = Boolean(data?.isGit && data.isTopLevel && projectRoot && cwd);
const current = data?.worktrees?.find((item) => item.path === cwd)
  ?? data?.worktrees?.find((item) => item.isMain)
  ?? null;
const label = loading
  ? "Worktrees…"
  : current?.branch ?? current?.path ?? "Worktree";
const disabledTitle = loading
  ? "Checking worktrees for this directory"
  : data?.isGit
    ? "Open a Git repository root to manage worktrees"
    : "Worktrees are available in Git repositories";
```

Copy the branch rows, main labels, new-worktree form, remove buttons, force confirmation, outside-click cleanup, hover styles, and icons from `components/SessionSidebar.tsx:1142-1458`. Change only the outer button sizing so it fits the top bar:

```tsx
style={{
  height: "100%",
  maxWidth: 220,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 12px",
  border: "none",
  borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
  borderRight: "1px solid var(--border)",
  background: open ? "var(--bg-selected)" : "none",
  color: enabled ? "var(--text-muted)" : "var(--text-dim)",
  cursor: enabled ? "pointer" : "not-allowed",
}}
```

The dropdown must be `position: absolute`, start below the 36px top bar, be at least 260px wide, and use `zIndex: 310` so it appears above chat content but below modal dialogs.

- [ ] **Step 5: Typecheck and lint the extracted component**

Run:

```bash
node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
```

Expected: both commands exit 0. The component may still be unused at this point; no `noUnusedLocals` error should occur because it is exported.

- [ ] **Step 6: Commit the Worktree component**

```bash
git add components/WorktreeSwitcher.tsx
git commit -m "feat: extract worktree switcher"
```

---

### Task 3: Build the Shared Workspace File Panel

**Files:**
- Create: `components/WorkspaceFilePanel.tsx`
- Reference: `components/SessionSidebar.tsx:1495-1612`
- Reference: `components/AppShell.tsx:1018-1060`
- Reference: `components/FileExplorer.tsx:1-31,371-460`

**Interfaces:**
- Consumes:

```ts
export type RightPanelMode = "closed" | "explorer" | "file";

interface WorkspaceFilePanelProps {
  mode: RightPanelMode;
  cwd: string | null;
  fileTabs: Tab[];
  activeFileTabId: string | null;
  explorerRefreshKey: number;
  onSelectFileTab: (tabId: string) => void;
  onCloseFileTab: (tabId: string) => void;
  onOpenFile: (filePath: string, fileName: string, sourceSessionId?: string | null) => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  onAtMentions: (relativePaths: string[]) => void;
}
```

- Produces: the existing `.right-panel-container` DOM with either Explorer or file-detail contents.

- [ ] **Step 1: Create the panel and Explorer toolbar**

Create `components/WorkspaceFilePanel.tsx` with the imports, public mode type, props above, and these state transitions:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getFileName } from "@/lib/file-paths";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";

export type RightPanelMode = "closed" | "explorer" | "file";

export function WorkspaceFilePanel(props: WorkspaceFilePanelProps) {
  const {
    mode,
    cwd,
    fileTabs,
    activeFileTabId,
    explorerRefreshKey,
    onSelectFileTab,
    onCloseFileTab,
    onOpenFile,
    onAtMention,
    onAtMentions,
  } = props;
  const explorerRef = useRef<FileExplorerHandle>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const refreshExplorer = () => {
    setLocalRefreshKey((value) => value + 1);
    setRefreshDone(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 2000);
  };

  return (
    <div
      className={`right-panel-container${mode === "closed" ? " right-panel-closed" : " right-panel-open"}`}
      style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", background: "var(--bg)" }}
    >
      {mode === "explorer" ? (
        <>
          <div style={{ height: 36, display: "flex", alignItems: "center", padding: "0 8px 0 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
            <strong style={{ flex: 1, fontSize: 11, color: "var(--text)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Explorer</strong>
            <button
              type="button"
              disabled={uploadBusy || !cwd}
              onClick={() => explorerRef.current?.openUploadPicker()}
              title="Upload files to project root"
              aria-label="Upload files"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, background: "none", border: "none",
                color: "var(--text-dim)", cursor: uploadBusy || !cwd ? "not-allowed" : "pointer",
                borderRadius: 5, opacity: uploadBusy || !cwd ? 0.5 : 1,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m17 8-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={refreshExplorer}
              title="Refresh explorer"
              aria-label="Refresh explorer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, background: refreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none", color: refreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer", borderRadius: 5,
              }}
            >
              {refreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            {cwd ? (
              <FileExplorer
                ref={explorerRef}
                cwd={cwd}
                onOpenFile={onOpenFile}
                refreshKey={explorerRefreshKey + localRefreshKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setUploadBusy}
              />
            ) : (
              <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>Select a project to browse files</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TabBar tabs={fileTabs} activeTabId={activeFileTabId ?? ""} onSelectTab={onSelectFileTab} onCloseTab={onCloseFileTab} />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeTab?.filePath ? (
              <FileViewer
                filePath={activeTab.filePath}
                cwd={cwd ?? undefined}
                sourceSessionId={activeTab.sourceSessionId}
                onOpenFile={(filePath) => onOpenFile(filePath, getFileName(filePath), activeTab.sourceSessionId)}
              />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>No file open</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

The toolbar uses the same upload and refresh SVG semantics as the previous sidebar explorer, with 26px icon buttons and a two-second green refresh confirmation.

- [ ] **Step 2: Make closed mode stable during width animation**

Do not conditionally unmount the outer container. When `mode === "closed"`, keep the most recent file branch mounted by using `mode === "explorer"` only for Explorer and the file branch otherwise. This preserves existing file tabs and lets CSS animate width to zero.

- [ ] **Step 3: Typecheck and lint the panel**

Run:

```bash
node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit the file panel**

```bash
git add components/WorkspaceFilePanel.tsx
git commit -m "feat: add shared workspace file panel"
```

---

### Task 4: Refactor SessionSidebar into Multi-Project Groups

**Files:**
- Modify: `components/SessionSidebar.tsx:1-2010`
- Test: `lib/sidebar-projects.test.mjs`

**Interfaces:**
- Consumes all Task 1 exports.
- New/changed props:

```ts
interface Props {
  selectedSessionId: string | null;
  activeProjectRoot: string | null;
  onSelectProject: (projectRoot: string, fallbackCwd: string) => void;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string, projectRoot: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
}
```

- Removes the old `selectedCwd`, `onCwdChange`, `onOpenFile`, `explorerRefreshKey`, `onAtMention`, and `onAtMentions` props.

- [ ] **Step 1: Replace local project helpers with Task 1 imports**

At the top of `components/SessionSidebar.tsx`, remove `FileExplorer`, `WorktreeEntry`, `WorktreeState`, `getRecentProjects`, the local session-tree interface, and local `buildSessionTree`. Import:

```tsx
import {
  buildSidebarSessionTree,
  getProjectActivity,
  groupSidebarProjects,
  parseExpandedProjects,
  parseManualProjects,
  serializeExpandedProjects,
  serializeManualProjects,
  upsertManualProject,
  type ManualProject,
  type SidebarProjectGroup,
  type SidebarSessionTreeNode,
} from "@/lib/sidebar-projects";
```

Update `SessionTreeItem` to consume `SidebarSessionTreeNode`.

- [ ] **Step 2: Replace obsolete state with project-list state**

Delete the current selected-cwd, project dropdown/filter, all Worktree state, and all Explorer state from `SessionSidebar.tsx:326-360`. Add:

```tsx
const MANUAL_PROJECTS_STORAGE_KEY = "pi-web:manual-projects";
const EXPANDED_PROJECTS_STORAGE_KEY = "pi-web:expanded-projects";

const [homeDir, setHomeDir] = useState("");
const [directoryOpen, setDirectoryOpen] = useState(false);
const [customPathValue, setCustomPathValue] = useState("");
const [customPathError, setCustomPathError] = useState<string | null>(null);
const [customPathValidating, setCustomPathValidating] = useState(false);
const [manualProjects, setManualProjects] = useState<ManualProject[]>(() => {
  if (typeof window === "undefined") return [];
  return parseManualProjects(window.localStorage.getItem(MANUAL_PROJECTS_STORAGE_KEY));
});
const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
  if (typeof window === "undefined") return new Set();
  return parseExpandedProjects(window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY));
});
const customPathInputRef = useRef<HTMLInputElement>(null);
const directoryPopoverRef = useRef<HTMLDivElement>(null);
const initializedExpansionRef = useRef(false);
```

Retain session loading, SSE authority, running ids, unread ids, refresh feedback, and initial URL restoration state.

- [ ] **Step 3: Add safe persistence effects**

```tsx
useEffect(() => {
  try {
    window.localStorage.setItem(MANUAL_PROJECTS_STORAGE_KEY, serializeManualProjects(manualProjects));
  } catch {
    // localStorage may be unavailable in privacy mode.
  }
}, [manualProjects]);

useEffect(() => {
  try {
    window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, serializeExpandedProjects(expandedProjects));
  } catch {
    // localStorage may be unavailable in privacy mode.
  }
}, [expandedProjects]);
```

After computing groups, initialize expansion once:

```tsx
const projectGroups = groupSidebarProjects(allSessions, manualProjects);

useEffect(() => {
  if (initializedExpansionRef.current || projectGroups.length === 0) return;
  initializedExpansionRef.current = true;
  if (expandedProjects.size === 0) {
    const initialRoot = activeProjectRoot ?? projectGroups[0].root;
    setExpandedProjects(new Set([initialRoot]));
  }
}, [activeProjectRoot, expandedProjects.size, projectGroups]);
```

- [ ] **Step 4: Preserve and adapt initial URL restoration**

Replace the old selected-cwd auto-selection effect with:

```tsx
useEffect(() => {
  if (allSessions.length === 0) return;
  if (initialSessionId && !restoredRef.current) {
    restoredRef.current = true;
    const target = allSessions.find((session) => session.id === initialSessionId);
    if (target) {
      setExpandedProjects((previous) => new Set(previous).add(target.projectRoot ?? target.cwd));
      onSelectSession(target, true);
      return;
    }
    onInitialRestoreDone?.();
  }
  if (!activeProjectRoot && projectGroups.length > 0) {
    const first = projectGroups[0];
    onSelectProject(first.root, first.root);
  }
}, [activeProjectRoot, allSessions, initialSessionId, onInitialRestoreDone, onSelectProject, onSelectSession, projectGroups]);
```

Ensure the callback identities in `AppShell` are stable so this effect does not loop.

- [ ] **Step 5: Adapt the directory picker and manual project persistence**

Keep the current `/api/cwd/validate`, desktop picker, and `/api/default-cwd` flows, but replace successful `setSelectedCwd(...)` calls with:

```tsx
const activateManualProject = useCallback((root: string) => {
  const openedAt = new Date().toISOString();
  setManualProjects((previous) => upsertManualProject(previous, root, openedAt));
  setExpandedProjects((previous) => new Set(previous).add(root));
  onSelectProject(root, root);
  setDirectoryOpen(false);
  setCustomPathValue("");
  setCustomPathError(null);
}, [onSelectProject]);
```

Call `activateManualProject(data.cwd ?? path)` after successful validation and `activateManualProject(data.cwd)` after creating a default directory.

Render the folder button beside Refresh in the top header. Browser clicks open the existing input/default-directory popover; desktop clicks invoke `window.piDesktop.selectDirectory()` first. Remove the old project list from the popover entirely.

- [ ] **Step 6: Render every project group**

Replace `SessionSidebar.tsx:732-773` and the single session list at `1460-1493` with:

```tsx
const toggleProject = useCallback((group: SidebarProjectGroup) => {
  onSelectProject(group.root, group.root);
  setExpandedProjects((previous) => {
    const next = new Set(previous);
    if (next.has(group.root)) next.delete(group.root);
    else next.add(group.root);
    return next;
  });
}, [onSelectProject]);

const startProjectSession = useCallback((group: SidebarProjectGroup) => {
  const tempId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  onNewSession?.(tempId, group.root, group.root);
}, [onNewSession]);
```

For each group:

```tsx
{projectGroups.map((group) => {
  const expanded = expandedProjects.has(group.root);
  const selected = activeProjectRoot === group.root;
  const activity = getProjectActivity(group.sessions, runningSessionIds, unreadSessionIds);
  const tree = buildSidebarSessionTree(group.sessions);
  return (
    <ProjectGroup
      key={group.root}
      group={group}
      expanded={expanded}
      selected={selected}
      activity={activity}
      homeDir={homeDir}
      selectedSessionId={selectedSessionId}
      runningSessionIds={runningSessionIds}
      unreadSessionIds={unreadSessionIds}
      onToggle={() => toggleProject(group)}
      onNewSession={(event) => {
        event.stopPropagation();
        startProjectSession(group);
      }}
      onSelectSession={onSelectSession}
      onRenamed={loadSessions}
      onSessionDeleted={(id) => {
        onSessionDeleted?.(id);
        void loadSessions();
      }}
      tree={tree}
    />
  );
})}
```

Implement `ProjectGroup` in the same file. Its row is 40px high, uses selected/hover backgrounds, has a rotating chevron, a left-truncated `PathLabel`, the `+` button, and `RunningSessionIndicator`/`UnreadSessionIndicator` on the far right. When expanded with no sessions, render `No sessions yet` at 11px muted text. When expanded with sessions, render existing `SessionTreeItem` rows unchanged except for invoking the parent `onSelectSession` directly.

- [ ] **Step 7: Remove migrated Worktree and Explorer blocks**

Delete:

- Worktree fetch/create/remove/effects and dropdown UI from `SessionSidebar.tsx:499-528,625-690,1142-1458`.
- Explorer state/effects and UI from `SessionSidebar.tsx:347-360,455-457,1495-1612`.
- Old top `New` button at `SessionSidebar.tsx:788-825`.
- Old project selector and filter UI at `SessionSidebar.tsx:868-1140`.

Retain `AnimatedDropdown` only if the new directory popover uses it; otherwise delete it and remove `ReactNode` from imports.

- [ ] **Step 8: Run tests, typecheck, and lint**

At this point `AppShell` still needs the new props, so complete Task 5 immediately before committing if TypeScript reports only the expected prop mismatch. Otherwise fix all sidebar-local errors first.

Run after Task 5 integration:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint -- --quiet
```

Expected: all commands exit 0.

---

### Task 5: Integrate Active Project State, Worktrees, and Right-Panel Modes

**Files:**
- Modify: `components/AppShell.tsx:1-1090`
- Modify: `app/globals.css:547-634`
- Modify: `components/SessionSidebar.tsx` only for integration corrections found by TypeScript

**Interfaces:**
- Consumes `WorktreeSwitcher`, `WorkspaceFilePanel`, `RightPanelMode`, and Task 4 props.
- Owns:

```ts
const [activeProjectRoot, setActiveProjectRoot] = useState<string | null>(null);
const [activeCwd, setActiveCwd] = useState<string | null>(null);
const [projectCwds, setProjectCwds] = useState<Map<string, string>>(() => new Map());
const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("closed");
```

- [ ] **Step 1: Replace boolean right-panel and workspace state**

In `components/AppShell.tsx`, import:

```tsx
import { WorktreeSwitcher } from "./WorktreeSwitcher";
import { WorkspaceFilePanel, type RightPanelMode } from "./WorkspaceFilePanel";
```

Remove direct `FileViewer` and `TabBar` imports. Replace `rightPanelOpen` with `rightPanelMode`. Add `activeProjectRoot` and `projectCwds` next to `activeCwd`.

- [ ] **Step 2: Centralize workspace activation**

Replace `handleCwdChange` with:

```tsx
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

  if (!cwd || suppressCwdBumpRef.current) {
    if (suppressCwdBumpRef.current) suppressCwdBumpRef.current = false;
    return;
  }
  if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === nextProject) return;

  setSelectedSession(null);
  setNewSessionCwd((previous) => previous && previous !== cwd ? null : previous);
  setSessionKey((value) => value + 1);
  setBranchTree([]);
  setBranchActiveLeafId(null);
  setSystemPrompt(null);
  setActiveTopPanel(null);
  router.replace("/", { scroll: false });
}, [router, selectedSession]);

const handleSelectProject = useCallback((projectRoot: string, fallbackCwd: string) => {
  activateWorkspace(projectCwds.get(projectRoot) ?? fallbackCwd, projectRoot);
}, [activateWorkspace, projectCwds]);
```

- [ ] **Step 3: Synchronize session and new-session selection**

At the start of `handleSelectSession`, add:

```tsx
const projectRoot = session.projectRoot ?? session.cwd;
setActiveProjectRoot(projectRoot);
setActiveCwd(session.cwd);
setProjectCwds((previous) => {
  const next = new Map(previous);
  next.set(projectRoot, session.cwd);
  return next;
});
```

Change `handleNewSession` to accept `projectRoot` and resolve remembered cwd:

```tsx
const handleNewSession = useCallback((_sessionId: string, fallbackCwd: string, projectRoot = fallbackCwd) => {
  const cwd = projectCwds.get(projectRoot) ?? fallbackCwd;
  setActiveProjectRoot(projectRoot);
  setActiveCwd(cwd);
  setProjectCwds((previous) => new Map(previous).set(projectRoot, cwd));
  setSelectedSession(null);
  setNewSessionCwd(cwd);
  setSessionKey((value) => value + 1);
  setBranchTree([]);
  setBranchActiveLeafId(null);
  setSystemPrompt(null);
  setActiveTopPanel(null);
  if (isMobile) setSidebarOpen(false);
  router.replace("/", { scroll: false });
}, [isMobile, projectCwds, router]);
```

Keep the keyboard shortcut calling `handleNewSession(..., activeCwd, activeProjectRoot ?? activeCwd)`.

- [ ] **Step 4: Update SessionSidebar props**

Replace the current `SessionSidebar` invocation with:

```tsx
<SessionSidebar
  selectedSessionId={selectedSession?.id ?? null}
  activeProjectRoot={activeProjectRoot}
  onSelectProject={handleSelectProject}
  onSelectSession={handleSelectSession}
  onNewSession={handleNewSession}
  initialSessionId={initialSessionId}
  onInitialRestoreDone={handleInitialRestoreDone}
  refreshKey={refreshKey}
  onSessionDeleted={handleSessionDeleted}
/>
```

Keep footer Models/Skills/Plugins behavior using `activeCwd`.

- [ ] **Step 5: Place WorktreeSwitcher before Full history**

Inside the `showChat` top-bar group, render before the Full history button:

```tsx
<WorktreeSwitcher
  projectRoot={activeProjectRoot}
  cwd={activeCwd}
  onCwdChange={(cwd, projectRoot) => activateWorkspace(cwd, projectRoot)}
/>
```

The Worktree control must remain visible but disabled when no manageable Git root exists. Confirm its right border separates it from Full history.

- [ ] **Step 6: Convert file callbacks to mode transitions**

In `handleOpenFile`, replace `setRightPanelOpen(true)` with `setRightPanelMode("file")`.

In `handleCloseFileTab`, when the last tab closes, use:

```tsx
if (next.length === 0) {
  setRightPanelMode((mode) => mode === "file" ? "closed" : mode);
}
```

Add:

```tsx
const toggleExplorerPanel = useCallback(() => {
  if (!activeCwd) return;
  if (isMobile) setSidebarOpen(false);
  setRightPanelMode((mode) => mode === "explorer" ? "closed" : "explorer");
}, [activeCwd, isMobile]);

const toggleFilePanel = useCallback(() => {
  if (fileTabs.length === 0) return;
  if (isMobile) setSidebarOpen(false);
  setRightPanelMode((mode) => mode === "file" ? "closed" : "file");
}, [fileTabs.length, isMobile]);
```

Update `handleSidebarToggle` so opening the mobile sidebar closes the right panel:

```tsx
const handleSidebarToggle = useCallback(() => {
  if (isMobile) {
    setActiveTopPanel(null);
    setRightPanelMode("closed");
  }
  setSidebarOpen((open) => !open);
}, [isMobile]);
```

- [ ] **Step 7: Replace inline file viewer with WorkspaceFilePanel**

Replace `AppShell.tsx:1018-1060` with:

```tsx
<WorkspaceFilePanel
  mode={rightPanelMode}
  cwd={activeCwd}
  fileTabs={fileTabs}
  activeFileTabId={activeFileTabId}
  explorerRefreshKey={explorerRefreshKey}
  onSelectFileTab={setActiveFileTabId}
  onCloseFileTab={handleCloseFileTab}
  onOpenFile={handleOpenFile}
  onAtMention={handleAtMention}
  onAtMentions={handleAtMentions}
/>
```

- [ ] **Step 8: Render two fixed right-corner buttons**

Replace the single fixed file-panel button with a wrapper at `position: fixed; top: 0; right: 0; z-index: 300; display: flex`. The left button controls Explorer and uses a folder-tree icon; the right button keeps the existing split-panel icon. Exact button rules:

```tsx
<button
  onClick={toggleExplorerPanel}
  disabled={!activeCwd}
  title={rightPanelMode === "explorer" ? "Hide file explorer" : "Show file explorer"}
  aria-label={rightPanelMode === "explorer" ? "Hide file explorer" : "Show file explorer"}
  aria-pressed={rightPanelMode === "explorer"}
/>
<button
  onClick={toggleFilePanel}
  disabled={fileTabs.length === 0}
  title={rightPanelMode === "file" ? "Hide file panel" : "Show file panel"}
  aria-label={rightPanelMode === "file" ? "Hide file panel" : "Show file panel"}
  aria-pressed={rightPanelMode === "file"}
/>
```

Each button is 36×36px. Explorer is immediately left of file detail. Disabled buttons use `opacity: 0.4` and `cursor: not-allowed`.

- [ ] **Step 9: Update layout padding and mobile CSS**

Change session-stats right padding from:

```tsx
paddingRight: rightPanelOpen ? 12 : 48,
```

to:

```tsx
paddingRight: rightPanelMode === "closed" ? 84 : 12,
```

Keep the existing `.right-panel-container` desktop width animation. In `app/globals.css`, retain mobile full-width behavior and ensure the right panel has a higher stacking order than chat but lower than the two fixed controls:

```css
@media (max-width: 640px) {
  .right-panel-container.right-panel-open {
    position: fixed;
    inset: 0;
    width: 100%;
    min-width: 0;
    z-index: 250;
  }
}

@media (prefers-reduced-motion: reduce) {
  .right-panel-container,
  .sidebar-container {
    transition: none !important;
  }
}
```

- [ ] **Step 10: Run targeted tests and static validation**

Run:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: all commands exit 0 with no warnings promoted to errors.

- [ ] **Step 11: Commit the integrated UI**

```bash
git add components/SessionSidebar.tsx components/AppShell.tsx components/WorktreeSwitcher.tsx components/WorkspaceFilePanel.tsx app/globals.css
git commit -m "feat: add multi-project workspace sidebar"
```

---

### Task 6: Run Full Regression Verification

**Files:**
- Modify only files required to fix verified regressions.

**Interfaces:**
- Verifies all prior tasks and the approved spec.

- [ ] **Step 1: Run the complete Node test suite**

Run:

```bash
node --test components/*.test.mjs lib/*.test.mjs
```

Expected: all existing and new tests PASS. If a failure is unrelated and pre-existing, capture its exact output before deciding whether it blocks; do not hide it.

- [ ] **Step 2: Run TypeScript and ESLint again**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Review the implementation diff against the specification**

Run:

```bash
git diff 450e1c8..HEAD --check
git diff 450e1c8..HEAD --stat
git status --short
```

Manually verify from the diff that:

- running SSE files are untouched;
- no search or count UI was added;
- Worktree UI no longer exists in `SessionSidebar`;
- `FileExplorer` no longer exists in `SessionSidebar`;
- `rightPanelMode` is the only right-panel visibility source;
- project `+` does not depend on React state settling before choosing cwd;
- localStorage reads are guarded against malformed data and exceptions.

- [ ] **Step 4: Fix any regression and re-run the failed command**

For each verified issue, make the smallest correction, then rerun the specific failing test or static command before rerunning the full gate.

- [ ] **Step 5: Commit verification fixes if any**

```bash
git add components lib app
if ! git diff --cached --quiet; then git commit -m "fix: stabilize workspace sidebar integration"; fi
```

---

### Task 7: Replace PM2 Production Process with the Development Instance

**Files:**
- No repository files are changed.

**Interfaces:**
- Replaces PM2 app `pi-web` currently executing `/opt/homebrew/bin/pi-web --hostname 0.0.0.0 --port 30141 --no-open`.
- Produces a PM2-managed development server from `/Users/proxy/Documents/program/pi-web` on port `30141`.

- [ ] **Step 1: Capture the current PM2 process and port state**

Run:

```bash
pm2 describe pi-web
lsof -nP -iTCP:30141 -sTCP:LISTEN
```

Expected: the current production `pi-web` process is online and owns port 30141.

- [ ] **Step 2: Replace the process without running a production build**

Run:

```bash
pm2 delete pi-web
pm2 start npm --name pi-web --cwd /Users/proxy/Documents/program/pi-web -- run dev -- --hostname 0.0.0.0
pm2 save
```

Expected: PM2 reports a new online `pi-web` process whose cwd is this repository and whose command is npm/Next dev.

- [ ] **Step 3: Wait for Next dev readiness and verify health**

Run:

```bash
pm2 logs pi-web --lines 80 --nostream
lsof -nP -iTCP:30141 -sTCP:LISTEN
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30141/
```

Expected:

- logs include the Next.js dev server ready message;
- a Node process listens on `*:30141` or `0.0.0.0:30141`;
- curl prints `200`.

If Next dev fails, inspect `pm2 logs pi-web --lines 200 --nostream`, fix the actual startup error, and repeat this step. Do not fall back to `next build`.

- [ ] **Step 4: Perform browser acceptance with the user**

Ask the user to refresh the existing pi-web URL and verify:

1. multiple projects can stay expanded;
2. two projects running concurrently both show project-level activity;
3. a completed background session changes its project to unread;
4. Worktree appears left of Full history;
5. Explorer and file detail buttons are mutually exclusive;
6. opening a file switches Explorer to file detail;
7. project expansion survives refresh.

Keep the development process running for user verification.

---

### Task 8: Independent Verification and Delivery

**Files:**
- No planned changes; corrections only if the verifier finds defects.

**Interfaces:**
- Input: approved specification, this plan, and all changed files.
- Output: independent PASS/PARTIAL/FAIL report and a final user-facing summary.

- [ ] **Step 1: Dispatch an independent verification agent**

Provide the verifier:

- original request and approved spec path;
- changed-file list from `git diff --name-only 450e1c8..HEAD`;
- requirements around running/unread aggregation, Worktree placement, right-panel mutual exclusion, localStorage, mobile, and unchanged SSE;
- instruction to inspect code and run decisive read-only tests without trusting implementation claims.

- [ ] **Step 2: Resolve verifier findings**

If FAIL, fix each concrete issue, rerun the relevant commands, and resume the same verifier with the correction. If PARTIAL, document what the environment prevented. If PASS, spot-check:

```bash
node --test lib/sidebar-projects.test.mjs
node_modules/.bin/tsc --noEmit
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:30141/
```

Expected: tests PASS, TypeScript exits 0, HTTP is 200.

- [ ] **Step 3: Report completion without claiming unverified browser behavior**

The final response must include:

- the project/session sidebar behavior implemented;
- Worktree and Explorer relocation;
- exact validation commands and results;
- PM2 dev process status and URL/port;
- any browser checks still awaiting the user;
- relevant commits and changed paths.
