# Codex Right Panel IA (from source)

Source bundles (extracted app):

- `thread-app-shell-chrome-D5Q2RjEl.js` — empty state, `+` menu, actions, chrome
- `thread-side-panel-tabs-C8h43RdK.js` — tab open helpers re-export
- `app-initial-cpPdPura.js` — command shortcuts

## Model

Right panel is a **multi-tab shell**, not a single exclusive surface.

- `RightPanelTabs` holds many tabs
- `RightPanelTabsEmptyState` shows the action list when **no tabs**
- `RightPanelTabListAfterSticky` hosts the **`+` open-tab menu** (same action list)
- Side chat / Files / Review are **tabs that can coexist** (screenshot: 侧边聊天 + 打开文件 / README.md)

## Empty state / `+` menu actions

Built in `Pn()` (`thread-app-shell-chrome`):

| id | label | condition | shortcut command |
|---|---|---|---|
| `review` | Review | git workspace, review tab not already open | `openReviewTab` |
| `terminal` | Terminal | terminal allowed for target | `toggleTerminal` (no keysLabel in menu for some targets) |
| `browser` | Browser | browser feature on | `openBrowserTab` |
| `open-file` | Files | workspace root present | `searchFiles` |
| `side-chat` | Side chat | local conversation present | `openSideChat` |

Git sort order (`In`):

```js
{ review: 0, terminal: 1, browser: 2, "open-file": 3 }
// side-chat / others keep insertion order after sorted known ids
```

Matches screenshots (zh): 审阅 → 终端 → 浏览器 → 文件 → 侧边聊天.

## Empty-state row chrome (source classes)

```
ul: mx-auto flex w-full max-w-xl flex-col gap-1 px-panel
button: flex min-h-10 w-full items-center gap-2 rounded-md bg-token-bg-fog px-2.5 py-2 text-left
        hover:bg-token-list-hover-background
icon: icon-xs text-token-text-secondary
title: text-sm font-normal text-token-text-primary truncate flex-1
shortcut: ms-auto shrink-0 ps-2 text-token-text-secondary  (keysLabel chip)
```

Container centers the list vertically (`justify-center`).

## Shortcuts (electron defaultKeybindings)

| command | key |
|---|---|
| `openSideChat` | `CmdOrCtrl+Alt+S` |
| `searchFiles` (Files) | `CmdOrCtrl+P` |
| `openReviewTab` | `Ctrl+Shift+G` |
| `openBrowserTab` | `CmdOrCtrl+T` |
| `toggleSidePanel` | `CmdOrCtrl+Alt+B` |
| `toggleTerminal` | `Control+\`` |

Note: pi-web historically used `Ctrl+Shift+E` for explorer; Codex Files entry uses **`Ctrl+P`**.

## Open behavior notes

- Opening side chat creates a **new** `sidechat:{conversationId}` tab (ephemeral fork), not a mode switch that destroys other tabs.
- Files open is deferred until dropdown close (`deferSelectionUntilDropdownClose`).
- Closing the last tab returns to empty state; panel chrome (expand/close) remains.
- Top-right expand + panel close cluster is independent of active tab content.

## pi-web mapping

| Codex | pi-web target |
|---|---|
| multi tabs | `rightPanelTabs[]` + `activeRightPanelTabId` |
| empty state | `RightPanelHome` (same action list) |
| `+` menu | tab bar plus dropdown (same list) |
| side chat tab | existing `SideChatPanel` as a tab body |
| files / open file | explorer + file tabs under files family |
| review / terminal / browser | review placeholder; terminal/browser disabled until capability exists |
