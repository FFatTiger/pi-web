# pi-web

[中文文档](./README.zh-CN.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). pi-web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and pi-web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

Then open [http://localhost:30141](http://localhost:30141). The CLI will try to open the browser automatically after the server is ready.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 127.0.0.1     # local access only
pi-web -p 8080 -H 127.0.0.1     # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.

## Notes

- **Data directory**: pi-web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in pi-web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.

### Local password authentication

When the application gate is enabled, pi-web requires a local password before the UI and business APIs are available. This is **not** the same as model-provider login or API keys under `/api/auth/*` (OAuth / keys for LLM providers). The application gate uses `/api/gate/*` (`/api/gate/status`, `/api/gate/login`, `/api/gate/logout`).

Config file path: `$PI_CODING_AGENT_DIR/pi-web.json` (default `~/.pi/agent/pi-web.json`).

```json
{
  "auth": {
    "password": "replace-with-a-strong-password",
    "disabled": false
  }
}
```

```bash
chmod 600 ~/.pi/agent/pi-web.json
PI_WEB_PASSWORD=replace-with-a-strong-password pi-web
PI_WEB_AUTH_DISABLED=true pi-web
```

- Environment variables override the matching file fields (`PI_WEB_PASSWORD` for `auth.password`, `PI_WEB_AUTH_DISABLED` for `auth.disabled`).
- If the config is missing, invalid, or has no usable password while the gate is not disabled, the app stays locked.
- Only an **explicit** disable (`"disabled": true` in the file, or `PI_WEB_AUTH_DISABLED=true`) removes the application gate entirely.
- After changing the config file or auth-related environment variables, restart pi-web so the new settings take effect.
- For LAN or public exposure, use a strong password, serve over HTTPS, and restrict access with a firewall or reverse proxy. Prefer binding to localhost when you do not need remote access.

### PWA and Web Push

pi-web can be installed as a Progressive Web App and optionally send system notifications when an Agent run settles. Closing the browser or PWA does **not** stop an Agent the server already accepted: as long as the pi-web process, host, and model network stay up, the run continues. Foreground traffic stays HTTP + SSE; Web Push starts only after server-side `agent_settled`.

Config lives in the same file as the application gate: `$PI_CODING_AGENT_DIR/pi-web.json` (default `~/.pi/agent/pi-web.json`). There are **no** VAPID environment variables—keys are generated and stored by pi-web.

```json
{
  "auth": { "password": "replace-me", "disabled": false },
  "push": { "disabled": false, "subject": "mailto:owner@example.com" }
}
```

```bash
PI_WEB_PUSH_DISABLED=true pi-web
PI_WEB_PUSH_SUBJECT=mailto:owner@example.com pi-web
```

- Precedence for Push: environment (`PI_WEB_PUSH_DISABLED`, `PI_WEB_PUSH_SUBJECT`) overrides `push` in `pi-web.json`; missing `push.disabled` defaults to enabled (`false`); missing subject defaults to `https://github.com/agegr/pi-web`. Subject must be a `mailto:` or `https:` URL. Invalid values lock Push only (safe status error)—they do not break the rest of pi-web.
- Push requires the application password gate to be **enabled** and the user authenticated. With the gate disabled, subscription APIs refuse Push.
- Browsers need a secure context: **HTTPS**, or **localhost** for local testing. Pi Web does **not** show install or notification enable/test/disable guidance UI. After an authenticated Push server check, it makes **one** automatic permission attempt while `Notification.permission` is still `default`, writing the versioned local marker `pi-web:push-auto-prompt-v1` **before** `Notification.requestPermission()` so reloads and remounts do not prompt again. Revoke or change permission later in browser/system settings. Some browsers (notably iOS Safari) may suppress automatic prompts without a user gesture or outside a Home Screen standalone PWA; iOS / iPadOS **16.4+** still requires Add to Home Screen for Push, and Pi Web stays quiet when the browser blocks the auto request. Manifest/Service Worker installability remains—use the browser’s own install affordance if available.
- Visible page with a live running SSE connection: after settle, AppShell shows an in-app toast and ACKs within about **1500ms** so system Push is suppressed. If ACK is missing (hidden, frozen, closed, or blocked), system Push is sent. Late ACK after timeout is ignored; a rare duplicate toast+Push is accepted.
- Notification copy is generic only (`Agent run finished` / `Agent run failed` / test text). No prompts, replies, paths, or tool output. Abort does not notify; intermediate retries/compaction do not; exactly one notification at final `agent_settled`.
- Service Worker caches only public PWA assets (`/offline.html`, `/manifest.webmanifest`, icons). No session, API, HTML app shell, Next chunks, or Background Sync. Offline navigation shows a generic fallback page.
- Private state file: `$PI_CODING_AGENT_DIR/pi-web-push.json` (default `~/.pi/agent/pi-web-push.json`), mode **0600**. Treat it like a secret in backups. Corruption locks Push until fixed (no silent key regeneration). Password change invalidates old subscription fingerprints; re-login with the new password rebinds the existing browser subscription without another permission prompt.
- Reverse proxy: terminate HTTPS correctly, do **not** buffer SSE, and keep long-lived connections open for `/api/agent/*/events` and `/api/agent/running/events`.
- Updates: a banner offers reload; automatic reload is disabled so an open session is not replaced mid-run. Confirming reload applies only in that tab; other tabs prompt for the activated version.

Manual platform matrix (not automated): [docs/pwa-web-push-acceptance.md](./docs/pwa-web-push-acceptance.md).

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://localhost:30141](http://localhost:30141).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    push/           # status, VAPID public key, subscribe, presence, test
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
  manifest.ts         # Web App Manifest
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs, PWA/Push shell
  SessionSidebar.tsx  # project selector, session tree, Explorer
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
  AppToast.tsx / OfflineBanner.tsx / PwaUpdateBanner.tsx / AuthControls.tsx
lib/
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary (+ Push secret deny)
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
  push-*.ts / pwa-lifecycle.ts / settled-cycle.ts
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAppPresence.ts   # single running SSE + toast ACK
  usePwaUpdate.ts / useWebPush.ts / useOnlineStatus.ts
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
public/
  sw.js / offline.html / icons/
bin/
  pi-web.js           # npm CLI entrypoint
```
