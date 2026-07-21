# Sidebar Session Visibility and Workspace Selection Design

**Date:** 2026-07-21  
**Status:** Approved for planning  
**Scope:** Refine the multi-project sidebar session list, project selection behavior, and row hierarchy styling.

## Goals

1. Keep each expanded project concise by default without hiding important activity.
2. Preserve the currently open chat when the user selects or expands another project.
3. Make project rows visually distinguishable from session rows without introducing heavy cards or borders.

## Non-goals

- No server, session file, SSE, API, or persistence-format changes.
- No search, pagination endpoint, virtualization, host metrics, or session counts on project rows.
- No change to explicit session navigation, session creation, deletion, rename, fork, or unread semantics.
- No long-term persistence for each project's “show all sessions” state.

## 1. Default Session Visibility Policy

Each project computes a default visible session set from its complete session collection.

### Priority order

Sessions are considered in this order:

1. Running sessions.
2. Sessions with unread results.
3. The session currently open in the main window.
4. Ordinary recent sessions.

Within each category, sessions are ordered by `modified` descending. A session belonging to more than one category appears once at its highest applicable priority.

### Ordinary session budget

- Show at most **five ordinary sessions** by default.
- Running, unread, and currently open sessions do **not** consume those five slots.
- An ordinary session is eligible only when its `modified` timestamp is within the last three days.
- Ordinary sessions older than three days are hidden by default and do not cause older sessions to be pulled into the five-slot budget.
- The cutoff is calculated at render-policy time from an injected/current `now`, allowing deterministic unit tests.

### Fork-tree integrity

The sidebar continues to render sessions as a fork tree.

- If a visible session has ancestors in the same project, its complete available ancestor chain is also visible.
- Ancestors included only to preserve structure do not consume the five ordinary-session slots.
- Descendants are not automatically included solely because their ancestor is visible.
- Missing ancestors retain the existing fallback behavior: the nearest available descendant becomes a root.

### Expand and collapse

- If any sessions are excluded by the default policy, show a project-local control: `Show all (N)`.
- `N` is the number of hidden sessions, excluding ancestor nodes already added to preserve visible paths.
- Activating it renders the complete project tree in existing time-descending order.
- The control changes to `Show less` and restores the default policy when activated again.
- This expanded-list state is independent per project and lasts only for the current mounted page. It is not stored in `localStorage`.
- Collapsing the entire project does not reset its show-all state during the same page lifetime.

## 2. Decouple Workspace Selection from the Open Chat

The selected workspace and the chat displayed in the main window are related but independent state.

### Clicking a project row

A project-row click must:

- select that project as the active workspace;
- restore its remembered cwd/worktree, falling back to the project root;
- update Worktree and File Explorer context;
- toggle that project's expanded/collapsed state;
- preserve the currently open session and its URL, even when that session belongs to another project.

A workspace selection alone must not display the new-session input page.

### Actions that may replace the main chat

The main window changes only after an explicit chat-navigation action:

- selecting a session;
- pressing a project's `+` button to create a session;
- deleting the currently open session;
- completing another existing explicit session-navigation operation.

The project `+` button remains propagation-isolated: it must neither trigger the project-row toggle nor accidentally reuse the currently displayed session.

### Worktree behavior

Changing worktree through the top Worktree control is also a workspace-context change and preserves the current chat. It updates the remembered cwd for the selected project and the File Explorer context. Explicitly creating or selecting a chat remains the boundary that replaces main-window content.

### URL behavior

- Selecting or expanding a project does not call `router.replace` and does not remove the current `?session=` parameter.
- Selecting another session updates the URL as before.
- Creating a new session clears/replaces session navigation as before.
- Initial URL restore behavior remains unchanged.

## 3. Visual Hierarchy

Project and session rows receive a subtle default-background difference.

- Project rows use a dedicated semantic background token derived from the panel color.
- Session rows retain the normal sidebar background.
- The project-row color must work in light and dark themes.
- Existing hover, selected-project, selected-session, running, unread, and accent-border states remain authoritative and visually stronger than the default tint.
- No additional thick border, card outline, increased spacing, or row-height change is introduced.

Suggested tokens:

- `--project-row-bg`
- `--project-row-hover` only if the existing `--bg-hover` does not produce sufficient contrast over the new base color.

## 4. Architecture

### Pure visibility helper

Add a pure helper in `lib/sidebar-projects.ts` that accepts:

- project sessions;
- running session IDs;
- unread session IDs;
- selected session ID;
- ordinary limit (default five);
- age cutoff/current time (default three days/current time).

It returns enough information for the UI to render without duplicating policy logic, including:

- the default visible session IDs or filtered tree;
- hidden session count;
- activity-priority ordering information as needed.

The existing complete-tree builder remains the source of parent/child relationships. The helper must preserve deterministic ordering and must not mutate the input sessions or ID sets.

### Sidebar UI state

`SessionSidebar` owns a page-lifetime `Set<string>` of projects showing all sessions. `ProjectGroup` receives the complete tree, default filtered tree, hidden count, and a show-all toggle callback.

### AppShell workspace activation

Refactor the current workspace activation path so that changing `activeProjectRoot`, `activeCwd`, and `projectCwds` does not clear `selectedSession`, branch state, system prompt, active panel, or session URL. Explicit new-session and session-navigation handlers retain responsibility for replacing chat state.

This separation applies consistently to project-row and WorktreeSwitcher changes, avoiding a one-off `preserveSession` flag that could be missed by future callers.

## 5. Error and Edge-Case Handling

- Invalid or missing `modified` timestamps are treated as old ordinary sessions unless the session is running, unread, or currently selected.
- A selected/running/unread session older than three days is still visible.
- If all sessions are hidden ordinary sessions, the expanded project shows the `Show all (N)` control rather than appearing to have no history.
- A project with no sessions continues to show its existing empty state.
- Running/unread state changes recompute the default visible set immediately but do not reorder project groups.
- If a visible child requires an old parent, the parent appears only for tree continuity and does not reduce the ordinary budget.
- Local UI state remains resilient when a project disappears from the session data; stale show-all keys are harmless and may be pruned opportunistically.

## 6. Testing and Acceptance

### Pure unit tests

Add coverage proving:

1. At most five eligible ordinary sessions are selected.
2. Running sessions are always visible and do not consume ordinary slots.
3. Unread sessions are always visible and do not consume ordinary slots.
4. The current main-window session is always visible and does not consume ordinary slots.
5. Duplicate activity categories do not duplicate sessions.
6. Ordinary sessions older than three days are hidden by default.
7. Selected/running/unread sessions older than three days remain visible.
8. Required ancestor chains are included without consuming ordinary slots.
9. Priority categories and sessions within them are ordered by `modified` descending.
10. Hidden count is correct and complete-tree mode still exposes every session.

### Behavioral verification

Verify manually or through focused component seams:

- Open session A, click project B's row: project B becomes active/expanded while session A remains in the main window and URL.
- Switch project B's Worktree: session A remains displayed.
- Click project B's `+`: the main window changes to B's new-session input.
- Click session B: the main window and URL change to session B.
- `Show all (N)` and `Show less` operate independently per project.
- Project/session row backgrounds are distinguishable in both themes, while hover and selected states remain clear.

### Regression gates

Run:

```bash
node --test next-config.test.mjs components/*.test.mjs lib/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build`. Restart the existing PM2 development instance and verify:

- PM2 serves the feature worktree;
- `/` and `/api/sessions` return HTTP 200;
- the `pi.huu.im` HMR WebSocket upgrade still returns HTTP 101.
