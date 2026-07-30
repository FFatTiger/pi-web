# Pi Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](./docs/screenshot2.png)

The same pi session in CLI and Pi Web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## About this fork

This repository is the [`FFatTiger/pi-web`](https://github.com/FFatTiger/pi-web) fork of [`agegr/pi-web`](https://github.com/agegr/pi-web). It keeps pi-web's local browser workspace while adding the security, remote-operation, project, and mobile behavior used by this fork.

| Area | This fork adds |
| --- | --- |
| Application access | A fail-closed password gate with signed sessions, login throttling, protected business APIs/SSE, and explicit opt-out only. |
| Projects and worktrees | Multi-project session grouping, linked-worktree resolution, worktree switching/creation/removal, and a project-scoped Explorer. |
| Mobile workflow | A session chooser on empty entry, focus-zoom-safe editable controls, compact navigation, complete session/context metrics, and sidebar logout. |
| Upstream PWA | Keeps the official upstream installable PWA (manifest, service worker, offline page, icons) without a fork-specific update UI or Web Push channel. |
| Security boundaries | Restricted file roots, streaming request limits, and the password gate layered on top of upstream host/origin API protections. |

> [!IMPORTANT]
> The npm package `@agegr/pi-web` is published by the upstream project. The `npx` and global-install commands below install upstream, not the fork-specific changes described above.

**Upstream baseline:** this fork is rebased on upstream **v0.8.6**, including Pi 0.83.0, Node.js >=22.19, loopback-default bind with explicit LAN scripts, PWA support, i18n, model discovery/catalog, project trust, request/path security and upload body limits, session-title/path hardening, model runtime reload/errors, markdown images/Mermaid/LaTeX, selected-file-line mentions, ChatInput history, minimap, and related security fixes. Fork-only production features above remain (password gate, multi-project UX, mobile polish). Compare [`agegr/pi-web`](https://github.com/agegr/pi-web) before the next rebase or release.

## Quick Start

### Run this fork from source

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`.

```bash
git clone https://github.com/FFatTiger/pi-web.git
cd pi-web
npm install
npm run dev
```

Then open [http://localhost:30141](http://localhost:30141). `npm run dev` binds to `127.0.0.1` by default; use `npm run dev:lan` to listen on `0.0.0.0` on a trusted network.

### Run the upstream npm release

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
pi-web --hostname 0.0.0.0       # expose on a trusted network
pi-web -p 8080 -H 0.0.0.0       # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # explicit network exposure
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

Pi Web listens on `127.0.0.1` by default. This fork adds a fail-closed password gate; still prefer loopback unless you intentionally expose a trusted LAN bind.

## HTTP Proxy

Pi Web reads the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for server-side model and API requests.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.

## Notes

- **Data directory**: Pi Web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
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

### Progressive Web App

This fork keeps the **upstream** installable PWA: Web App Manifest, service worker, offline fallback page, and icons. There is no fork-specific PWA update banner and no Web Push / completion-notification channel.


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
    gate/           # application password gate status/login/logout
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    project-trust/  # project trust status and trust action
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
    worktrees/      # git worktree list/create/remove
  login/              # application password login page
  manifest.ts         # Web App Manifest (upstream)
components/
  AppShell.tsx        # main layout, multi-project wiring, project trust, top panels
  SessionSidebar.tsx  # multi-project groups, session tree, AuthControls
  WorkspaceFilePanel.tsx / WorktreeSwitcher.tsx
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
  LoginForm.tsx / AuthControls.tsx / PwaRegistration.tsx
lib/
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  sidebar-projects.ts # multi-project grouping helpers
  web-auth-*.ts       # password gate config/session/rate-limit
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useI18n.tsx         # locale provider and translations
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
public/
  sw.js / offline.html / icons/   # upstream PWA assets
bin/
  pi-web.js           # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
