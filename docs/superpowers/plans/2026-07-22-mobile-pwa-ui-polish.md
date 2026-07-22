# Mobile PWA UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent mobile focus zoom, remove PWA/notification guidance controls, auto-request notification permission once, and place logout in the sidebar header.

**Architecture:** A mobile CSS font-size floor fixes browser focus zoom without disabling accessibility zoom. `useWebPush` becomes a headless one-time permission/subscription reconciler mounted by AppShell, while install/notification guidance components are no longer rendered. `AuthControls` gains a compact sidebar presentation and moves into `SessionSidebar`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Web Push/Service Worker APIs, Node test runner, source-contract tests.

## Global Constraints

- Preserve user pinch zoom; do not add `maximum-scale=1` or `user-scalable=no`.
- Keep OfflineBanner, PwaUpdateBanner, AppToast, Service Worker registration, manifest/installability, and existing HTTP/SSE architecture.
- Remove PwaInstallPrompt, PwaSettingsControl, and PushNotificationControl from production rendering.
- Notification permission may be attempted automatically at most once per versioned localStorage marker while state is `default`.
- Write the marker before `Notification.requestPermission()` so StrictMode/reloads cannot repeat the prompt.
- Permission/subscription errors are silent and must not block AppShell.
- Keep the existing application password config and PM2 production command unchanged.
- Do not run `next build` while the production process is reading the same `.next`; build in the isolated worktree first, then merge and rebuild during a controlled restart.

---

### Task 1: Prevent Mobile Focus Zoom

**Files:**
- Modify: `app/globals.css`
- Create: `app/mobile-focus.test.mjs`

**Interfaces:**
- Produces a mobile-only computed font-size floor for `input`, `textarea`, and `select`.
- Does not change viewport scale permissions.

- [ ] **Step 1: Write failing source-contract tests**

Create `app/mobile-focus.test.mjs` that reads `app/globals.css` and `app/layout.tsx` and asserts:

```js
assert.match(css, /@media\s*\([^)]*max-width:[^)]+\)[\s\S]*input[\s\S]*textarea[\s\S]*select[\s\S]*font-size:\s*16px\s*!important/);
assert.doesNotMatch(layout, /maximumScale|max(?:imum)?-scale|userScalable|user-scalable/);
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test app/mobile-focus.test.mjs
```

Expected: FAIL because no mobile 16px editable-control rule exists.

- [ ] **Step 3: Add the minimal mobile CSS rule**

Append to `app/globals.css`:

```css
@media (max-width: 768px) {
  input,
  textarea,
  select {
    font-size: 16px !important;
  }
}
```

Do not alter `app/layout.tsx` viewport zoom options.

- [ ] **Step 4: Run GREEN and relevant UI tests**

```bash
node --test app/mobile-focus.test.mjs components/SessionSidebar.project-click.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/mobile-focus.test.mjs
git commit -m "fix: prevent mobile input focus zoom"
```

---

### Task 2: Replace Notification Guidance With One Silent Automatic Attempt

**Files:**
- Modify: `hooks/useWebPush.ts`
- Modify: `hooks/useWebPush.test.mjs`
- Modify: `components/AppShell.tsx`
- Modify: `components/AppShell.pwa.test.mjs`
- Modify: `components/PushNotificationControl.test.mjs`
- Delete: `components/PwaInstallPrompt.tsx`
- Delete: `components/PwaSettingsControl.tsx`
- Delete: `components/PushNotificationControl.tsx`

**Interfaces:**
- `useWebPush()` remains the browser Push reconciler and is called exactly once by `AppShell`.
- A versioned key, e.g. `pi-web:push-auto-prompt-v1`, prevents repeated automatic permission attempts.
- Existing protected APIs and subscription serializers remain unchanged.

- [ ] **Step 1: Rewrite tests for the desired contract**

Update `hooks/useWebPush.test.mjs` to assert from source that:

```js
assert.match(source, /const AUTO_PROMPT_KEY = "pi-web:push-auto-prompt-v1"/);
assert.match(source, /Notification\.permission === "default"/);
assert.ok(source.indexOf("localStorage.setItem(AUTO_PROMPT_KEY") < source.indexOf("Notification.requestPermission()"));
assert.doesNotMatch(source, /requestPermission[\s\S]*const enable = useCallback/);
```

Retain serializer/base64 tests.

Update `components/AppShell.pwa.test.mjs` to assert:

```js
assert.match(shell, /useWebPush\(\)/);
assert.doesNotMatch(shell, /PwaInstallPrompt|PwaSettingsControl|PushNotificationControl/);
assert.match(shell, /<OfflineBanner/);
assert.match(shell, /<PwaUpdateBanner/);
assert.match(shell, /<AppToast/);
```

Replace `components/PushNotificationControl.test.mjs` with a removal contract that asserts the component file is absent and AppShell has no import/reference.

- [ ] **Step 2: Run RED**

```bash
node --test hooks/useWebPush.test.mjs components/AppShell.pwa.test.mjs components/PushNotificationControl.test.mjs
```

Expected: FAIL because permission is explicit-button-only and guidance controls are still mounted.

- [ ] **Step 3: Implement automatic one-time reconciliation**

In `hooks/useWebPush.ts`:

1. Add `AUTO_PROMPT_KEY`.
2. Keep `browserSupportsPush`, `requirePushServer`, `getOrCreateSubscription`, `postSubscription`, serializers, and existing reconciliation helpers.
3. In the mount `run()` path:
   - return silently when unsupported;
   - call `requirePushServer()` before permission request;
   - when permission is `default` and marker absent, write marker, then call `requestPermission()`;
   - update permission state;
   - if granted, get/create/post subscription and set enabled preference/subscribed state;
   - if denied/default/error, set subscribed false and do not render or throw an error to UI.
4. Existing granted users reconcile without another permission request.
5. The hook may retain methods for internal compatibility, but AppShell renders no settings control. Prefer removing unused public methods/state after callers are gone if TypeScript confirms no usage.

- [ ] **Step 4: Remove production guidance UI**

In `components/AppShell.tsx`:

- remove imports and JSX for `PwaInstallPrompt`, `PwaSettingsControl`, and `PushNotificationControl`;
- call `useWebPush()` once headlessly;
- retain `usePwaInstall()` only if still required elsewhere; otherwise remove it and its import;
- retain `usePwaUpdate`, `OfflineBanner`, `PwaUpdateBanner`, `AppToast`.

Delete the three unused component files.

- [ ] **Step 5: Run GREEN and PWA/Push regressions**

```bash
node --test \
  hooks/useWebPush.test.mjs \
  components/AppShell.pwa.test.mjs \
  components/PushNotificationControl.test.mjs \
  public/sw-policy.test.mjs \
  public/pwa-assets.test.mjs \
  hooks/useAppPresence.test.mjs \
  components/AppShell.presence.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/useWebPush.ts hooks/useWebPush.test.mjs components/AppShell.tsx components/AppShell.pwa.test.mjs components/PushNotificationControl.test.mjs
git add -u components/PwaInstallPrompt.tsx components/PwaSettingsControl.tsx components/PushNotificationControl.tsx
git commit -m "refactor: make Push permission headless"
```

---

### Task 3: Move Logout Into Sidebar Header

**Files:**
- Modify: `components/AuthControls.tsx`
- Modify: `components/SessionSidebar.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `components/AppShell.auth.test.mjs`
- Create: `components/SessionSidebar.auth.test.mjs`

**Interfaces:**
- Add `AuthControlsProps = { compact?: boolean }`.
- `compact` renders a 32×32 icon-only sidebar control while preserving status fetch/logout behavior.
- `SessionSidebar` owns the compact `AuthControls` placement.

- [ ] **Step 1: Write failing placement tests**

Create `components/SessionSidebar.auth.test.mjs` reading sidebar and shell source:

```js
assert.match(sidebar, /import \{ AuthControls \}/);
assert.match(sidebar, /aria-label="Refresh sessions"[\s\S]*aria-label="Open directory"[\s\S]*<AuthControls compact/);
assert.doesNotMatch(shell, /<AuthControls/);
assert.doesNotMatch(shell, /Fixed bottom-right authentication/);
```

Update `components/AppShell.auth.test.mjs` to remove the old fixed-bottom-right expectations and assert auth is delegated to `SessionSidebar`.

- [ ] **Step 2: Run RED**

```bash
node --test components/SessionSidebar.auth.test.mjs components/AppShell.auth.test.mjs
```

Expected: FAIL because logout remains fixed in AppShell.

- [ ] **Step 3: Add compact AuthControls presentation**

In `components/AuthControls.tsx`:

```ts
export type AuthControlsProps = { compact?: boolean };
export function AuthControls({ compact = false }: AuthControlsProps) { ... }
```

For both enabled and disabled states, when `compact`:

- width/minWidth/height: 32;
- padding: 0;
- border radius: 7;
- no shadow;
- icon only;
- preserve title/aria label and logout behavior.

- [ ] **Step 4: Move the component**

- Import `AuthControls` in `SessionSidebar.tsx`.
- Render `<AuthControls compact />` after the Open directory button and before `AnimatedDropdown`.
- Remove the fixed bottom-right auth/notification wrapper and `AuthControls` import from `AppShell.tsx`.
- Ensure `directoryPopoverRef` still wraps the header group so the directory dropdown's outside-click behavior remains correct.

- [ ] **Step 5: Run GREEN and regressions**

```bash
node --test \
  components/SessionSidebar.auth.test.mjs \
  components/AppShell.auth.test.mjs \
  components/SessionSidebar.project-click.test.mjs \
  components/AppShell.workspace.test.mjs \
  app/api/gate/routes.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/AuthControls.tsx components/SessionSidebar.tsx components/AppShell.tsx components/AppShell.auth.test.mjs components/SessionSidebar.auth.test.mjs
git commit -m "refactor: move logout into sidebar"
```

---

### Task 4: Documentation, Full Verification, and Production Deployment

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/pwa-web-push-acceptance.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Documentation states one automatic permission attempt rather than an explicit Enable control.
- Manual acceptance checks no repeated prompt and no guidance UI.

- [ ] **Step 1: Update documentation contracts**

Replace explicit notification-enable button instructions with:

- one automatic request while permission is `default`;
- no repeated prompt after the versioned local marker is set;
- browser/system settings govern later permission changes;
- iOS may suppress automatic requests outside permitted contexts and Pi Web remains quiet;
- install UI is no longer shown by Pi Web, though manifest/PWA installability remains.

Update AGENTS module map to remove deleted components and record the one-time auto-prompt marker.

- [ ] **Step 2: Run complete automated verification**

```bash
node --test $(find . \
  -path './node_modules' -prune -o \
  -path './.next' -prune -o \
  -path './.git' -prune -o \
  -name '*.test.mjs' -print)
node_modules/.bin/tsc --noEmit
node --check public/sw.js
node_modules/.bin/eslint \
  app/globals.css app/layout.tsx \
  components/AppShell.tsx components/AuthControls.tsx components/SessionSidebar.tsx \
  components/OfflineBanner.tsx components/PwaUpdateBanner.tsx components/AppToast.tsx \
  hooks/useWebPush.ts hooks/usePwaUpdate.ts hooks/useAppPresence.ts
npm run build
```

If ESLint does not accept CSS input, lint only TypeScript/TSX and use the Node source-contract test for CSS.

Expected: all tests/type/lint/build pass.

- [ ] **Step 3: Commit docs**

```bash
git add README.md README.zh-CN.md docs/pwa-web-push-acceptance.md AGENTS.md
git commit -m "docs: explain automatic Push permission"
```

- [ ] **Step 4: Independent review**

Launch a fresh verification agent for mobile zoom accessibility, one-time permission ordering/StrictMode behavior, removed guidance UI, sidebar logout placement, and unchanged PWA update/Push security behavior. Fix valid findings with RED tests.

- [ ] **Step 5: Merge and deploy**

After approval:

1. Fast-forward `main` from `feat/mobile-pwa-ui-polish`.
2. Stop PM2 `pi-web` only during the main-worktree build window.
3. `rm -rf .next && npm run build` on main.
4. Restart the existing production PM2 process (`npm run start -- --hostname 0.0.0.0`, interpreter none, same cwd/environment/config).
5. Verify PM2 online/0 unstable restarts, local/public gate/PWA endpoints, login static assets, and mobile CSS in the built stylesheet.

- [ ] **Step 6: Final report**

Report commits, tests, production Build ID, PM2 command/status, and note the browser limitation that automatic notification prompts may be suppressed when a user gesture is required.
