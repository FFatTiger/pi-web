# Pi Agent Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running/events ───▶ running ids + presence/notification SSE
  ├─ POST /api/push/presence ────────▶ visibility heartbeat / toast ACK
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/
  manifest.ts                         Web App Manifest
  login/page.tsx                      application gate login page
  api/
    sessions/route.ts               GET  list all sessions
    sessions/[id]/route.ts          GET/PATCH/DELETE session
    sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
    sessions/[id]/export/route.ts   GET exported HTML for a session
    agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
    agent/[id]/route.ts             GET state | POST any command
    agent/[id]/events/route.ts      GET SSE stream
    agent/running/events/route.ts   GET SSE stream of currently-running session ids
    auth/all-providers/route.ts     GET API-key provider list
    auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
    auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
    auth/logout/[provider]/route.ts POST OAuth logout
    auth/providers/route.ts         GET OAuth provider list
    gate/status/route.ts            GET application gate public status
    gate/login/route.ts             POST application password login
    gate/logout/route.ts            POST clear application gate session cookie
    cwd/validate/route.ts           POST validate/select a cwd
    default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
    files/[...path]/route.ts        GET file contents for viewer
    home/route.ts                   GET user home directory
    models/route.ts                 GET { models, modelList, defaultModel }
    models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
    models-config/test/route.ts     POST test a configured model/provider
    plugins/route.ts                GET/POST package plugin management
    push/status/route.ts             GET safe Push/browser/config status
    push/vapid-public-key/route.ts   GET VAPID public key
    push/subscribe/route.ts          POST/DELETE authenticated subscription
    push/test/route.ts               POST fixed test notification
    push/presence/route.ts           POST visibility heartbeat / toast ACK
    skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
    skills/install/route.ts         POST install skills through npx skills add
    skills/search/route.ts          GET/POST skills.sh search
    worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  pwa-lifecycle.ts    pure install/update lifecycle decisions
  push-config.ts      independent Push config and status taxonomy
  push-endpoint.ts    subscription body parsing and route helpers
  push-notifier.ts    settled result → visible ACK or Web Push fallback
  push-paths.ts       unconditional Push state/temp-name denial
  push-presence.ts    process-local visible connection and 1500 ms ACK registry
  push-request.ts     authenticated same-origin JSON + streaming 16 KiB boundary
  push-service.ts     bounded parallel Web Push delivery and cleanup
  push-store.ts       atomic VAPID/subscription persistence + password epochs
  push-target.ts      endpoint validation and actual-socket DNS policy
  push-types.ts       fixed notification payload/presentation protocol
  settled-cycle.ts    server-owned agent_start/end/settled cycle tracker
  worktree.ts         project/worktree resolution and git worktree operations
  web-auth-config.ts  pi-web.json + PI_WEB_* env → GateConfig
  web-auth-session.ts signed cookie issue/verify for the application gate
  web-auth-request.ts gate decision helper (redirect / JSON / next)
  web-auth-rate-limit.ts login attempt rate limiting

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    markdown renderer
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)
  LoginForm.tsx       application gate login form
  AuthControls.tsx    shell gate status + logout control (compact in sidebar header)
  AppToast.tsx        fixed-copy rendered completion toast
  OfflineBanner.tsx   offline state UI
  PwaUpdateBanner.tsx user-confirmed waiting-worker update UI

proxy.ts              Next.js 16 request gate (replaces middleware.ts)

hooks/
  useAgentSession.ts  messages + streaming + per-session SSE + fork/navigate/reconciliation logic
  useAppPresence.ts   sole global running SSE owner + 15s visibility heartbeat
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useOnlineStatus.ts  browser online/offline state
  usePwaUpdate.ts     SW registration and user-confirmed update lifecycle
  useTheme.ts         theme state
  useWebPush.ts       headless one-time auto permission + subscription reconciliation

public/
  sw.js               conservative offline/update/Push Service Worker
  offline.html        generic offline fallback
  icons/              bounded public normal/Apple/maskable/badge icons
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state SSE + reconciliation
- `useAppPresence` in `AppShell` is the **sole global owner** of `/api/agent/running/events`; `SessionSidebar` only receives the live running-id set as props. Do not add a second owner. Per-session SSE in `useAgentSession` remains separate and unchanged.
- The global stream sends `connected` (opaque presence id), `running`, and fixed-schema `notification` frames. Visible tabs POST a heartbeat every 15 seconds; server presence becomes stale after 35 seconds.
- A foreground notification suppresses Web Push only after `AppToast` visibly commits and authenticated presence ACKs the matching notification within 1500 ms. Receiving/enqueuing the SSE frame is not an ACK. Hidden, stale, disconnected, failed, or timed-out clients fall back to Push; a rare late-ACK duplicate is safer than a missed completion.
- `useAgentSession` still treats per-session SSE as primary for chat events, but while a run is active it periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed final events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles. `agent_end` with `willRetry: true` must not finish foreground streaming state.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- `$PI_CODING_AGENT_DIR/pi-web-push.json` and its temp forms are unconditionally secret. Deny them before existence/conflict checks across `/api/files`, `/api/file-index`, File Explorer, uploads, listings, session references, case aliases, and symlink aliases.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Application password gate (do not confuse with provider auth)
- `app/api/auth/*` is **model-provider** auth (OAuth / API keys). `/api/gate/*` is the **application password gate** that protects the UI and business APIs.
- Config lives at `$PI_CODING_AGENT_DIR/pi-web.json` (default `~/.pi/agent/pi-web.json`) with `auth.password` / `auth.disabled`. Env overrides: `PI_WEB_PASSWORD`, `PI_WEB_AUTH_DISABLED`.
- Missing/invalid `pi-web.json` (or unusable password without disable) must **lock**; only explicit `disabled: true` / `PI_WEB_AUTH_DISABLED=true` bypasses the gate.
- `proxy.ts` is the Next.js 16 filename; do **not** reintroduce `middleware.ts`.
- All business APIs, including SSE and provider auth, stay inside the `proxy.ts` matcher. Public gate routes and `/login` are allow-listed by `decideGateRequest`.
- Password changes invalidate cookies because the signing key derives from the current password.
- Never return config `logMessage` to the browser; log server-side only on `status: "error"`.

### PWA, Service Worker, and Web Push
- Exact public gate bypasses are `/manifest.webmanifest`, `/sw.js`, `/offline.html`, and bounded `/icons/*`. Lookalikes and every `/api/push/*` route remain protected. `/sw.js` has root scope and exact no-cache headers.
- Register the Service Worker on localhost/development as well as production. Its cache may contain only `/offline.html`, `/manifest.webmanifest`, and the five public icons—never `/api/*`, SSE, auth HTML, app HTML/RSC, Next chunks, sessions, prompts, code, paths, or tool output. There is no Background Sync.
- Do not call `skipWaiting()` at install time. A waiting worker activates only after user confirmation; only the confirming tab auto-reloads, while other controlled tabs show an activated-version prompt.
- Notification permission is attempted once automatically while state is `default` and the versioned local marker `pi-web:push-auto-prompt-v1` is absent. Write the marker before `Notification.requestPermission()` so StrictMode remounts and reloads do not re-prompt. Denied/default/unsupported/server-unavailable paths stay silent—there is no enable/test/disable/install guidance UI. Revocation is browser/system settings only. iOS/iPadOS 16.4+ still requires an installed Home Screen PWA for Push, and browsers may suppress automatic permission prompts without a user gesture; remain quiet when suppressed. Manifest/SW installability remains without Pi Web install UI.
- Payloads are the exact v1 `agent`/`test` union in `push-types.ts`; notification title/body/tag/URL are derived locally. Never accept arbitrary presentation or navigation from the server.
- Push config is independent from the application gate, but delivery/subscription requires the gate enabled. State is atomic `0600`; subscriptions are HMAC-bound to the current password epoch and capped at 20.
- Every Push request passes application auth, exact same-origin checks, JSON media type, and a true streaming 16 KiB limit. Do not replace it with a post-read length check.
- `push-target.ts` rejects IP literals and private/local/mixed DNS results through the actual `https.Agent.lookup` used by `web-push`; do not add a DNS preflight or proxy path. Each device has a service-level 10-second deadline in addition to the library socket timeout.
- `SettledCycleTracker` in `rpc-manager.ts` owns notification cycles. Only final `agent_settled` consumes a cycle and schedules a notification; `agent_end`, retry, compaction, steer/follow-up, queued continuation, prompt errors, and aborted results do not independently notify. Notification work is fire-and-catch and must never reject Agent HTTP/SSE flow.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
