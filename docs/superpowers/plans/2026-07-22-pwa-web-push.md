# PWA and Web Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an installable, safely updating Pi Agent Web PWA with privacy-preserving offline fallback and authenticated VAPID Web Push that notifies only after a server-side Agent run truly settles.

**Architecture:** Keep all existing HTTP commands and both SSE paths. A conservative public Service Worker caches only manifest/icons/offline fallback, while server-only Push modules own VAPID persistence, subscription authorization, socket-bound endpoint validation, presence ACK arbitration, and `agent_settled` notification routing. `AppShell` becomes the single owner of the global running-events SSE; per-session SSE remains untouched.

**Tech Stack:** Next.js 16.2.9 App Router and `proxy.ts`, React 19, TypeScript, Node `crypto`/`dns`/`fs`/`https`, `web-push@3.6.7`, standard Service Worker/Push APIs, Node `node:test` with `jiti`, Pillow for deterministic icon generation.

## Global Constraints

- Foreground commands remain HTTP; per-session events remain `/api/agent/[id]/events`; global running state remains `/api/agent/running/events`. Do not introduce WebSockets.
- Closing or backgrounding the browser must not stop an accepted server-side Agent run.
- Completion routing is triggered only by `agent_settled`; intermediate `agent_end`, retries, compaction, and queued continuations do not notify.
- A visible page suppresses Web Push only after it displays and ACKs the in-app toast within 1500 ms.
- Client heartbeat interval is 15 seconds; server presence staleness is 35 seconds.
- Notification permission is requested only by an explicit user click.
- Service Worker Cache Storage contains only `/offline.html`, `/manifest.webmanifest`, and `/icons/*`; never cache `/api/*`, SSE, login/authenticated HTML, RSC, Next chunks, sessions, prompts, code, paths, or tool output.
- Do not call `skipWaiting()` during install. Only a user-confirmed update sends `SKIP_WAITING`, and only the confirming tab reloads automatically.
- Public PWA paths are exactly `/manifest.webmanifest`, `/sw.js`, `/offline.html`, and the bounded `/icons/` prefix. Similar paths remain gated.
- `/sw.js` must return `Cache-Control: no-cache, max-age=0, must-revalidate` and `Service-Worker-Allowed: /`.
- Push is unavailable when the application gate is disabled, unconfigured, erroneous, or the request did not pass through the enabled gate.
- Push state lives at `$PI_CODING_AGENT_DIR/pi-web-push.json`, mode `0600`, with same-directory `pi-web-push.json.tmp-*` atomic writes and a serialized mutation queue.
- The Push state file and its temp files are unconditionally denied by `/api/files`, directory listing, session-reference authorization, download/preview/watch, and upload destinations.
- Subscription endpoint is globally unique; maximum subscriptions is 20. Re-authenticated upsert of the same endpoint replaces old keys/fingerprint without consuming a new slot.
- Mutating Push JSON bodies are limited to 16 KiB. Endpoint is at most 4096 UTF-8 bytes. `p256dh` is exactly 87 unpadded base64url characters decoding to a 65-byte `0x04` P-256 point; `auth` is exactly 22 characters decoding to 16 bytes.
- Push connections use a custom `https.Agent` lookup that validates every A/AAAA result at actual socket creation. Reject empty, loopback, link-local, RFC1918, CGNAT, ULA, IPv4-mapped private, and mixed public/private result sets. Never configure `web-push` proxy support.
- Push send timeout is 10 seconds; TTL is 300 seconds. Delete 404/410 subscriptions; retain 401/403, 429, and 5xx subscriptions.
- Notification payload version 1 is a discriminated union: Agent `{version:1,id,kind:"agent",sessionId,result}` and test `{version:1,id,kind:"test"}`. The server never supplies arbitrary title, body, tag, or URL.
- Keep `web-push` in runtime dependencies and `@types/web-push` in dev dependencies. Update both `package-lock.json` and `bun.lock`.
- Follow strict RED-GREEN-REFACTOR. Every production behavior first appears in a test that is run and observed failing for the expected reason.
- Do not run `next build` during development. Final verification uses Node tests, `tsc --noEmit`, changed-file ESLint, `node --check public/sw.js`, and `npm pack --dry-run`.

## File Structure

### Create

- `app/manifest.ts` — Next.js manifest source for install metadata.
- `app/api/push/status/route.ts` — safe Push capability/status response.
- `app/api/push/vapid-public-key/route.ts` — authenticated VAPID public key response.
- `app/api/push/subscribe/route.ts` — subscribe and unsubscribe handlers.
- `app/api/push/presence/route.ts` — heartbeat, visibility, and toast ACK handler.
- `app/api/push/test/route.ts` — fixed-payload test Push handler.
- `components/AppToast.tsx` — shell-level settled-run toast that ACKs only after mount.
- `components/OfflineBanner.tsx` — last-known-state warning for an already-open offline app.
- `components/PwaInstallPrompt.tsx` — Chromium install action and iOS instructions.
- `components/PwaSettingsControl.tsx` — persistent non-standalone entry that reopens dismissed install instructions.
- `components/PwaUpdateBanner.tsx` — user-controlled waiting-worker activation.
- `components/PushNotificationControl.tsx` — explicit notification opt-in/disable/test UI.
- `hooks/useAppPresence.ts` — sole global running-events EventSource owner and presence client.
- `hooks/useOnlineStatus.ts` — browser online/offline state.
- `hooks/usePwaInstall.ts` — installability/standalone/dismissal state.
- `hooks/usePwaUpdate.ts` — Service Worker registration and multi-tab-safe update state.
- `hooks/useWebPush.ts` — browser Push subscription reconciliation and user actions.
- `lib/push-types.ts` — payload types, validation, fixed copy, tags, and safe target URLs.
- `lib/push-paths.ts` — Push state path and unconditional secret-path detection.
- `lib/push-config.ts` — strict Push config/env parsing independent from gate parsing.
- `lib/push-store.ts` — VAPID generation, fingerprinting, atomic state persistence, and subscription mutations.
- `lib/push-target.ts` — subscription field validation and socket-bound DNS/IP policy.
- `lib/push-request.ts` — Origin/content-type/body-limit/gate helpers and no-store JSON responses.
- `lib/push-service.ts` — parallel `web-push` delivery and stale endpoint cleanup.
- `lib/push-presence.ts` — global presence registry and authenticated ACK waiters.
- `lib/push-notifier.ts` — settled result classification and toast-or-Push orchestration.
- `lib/settled-cycle.ts` — pure server-owned Agent start/end/settled cycle state machine.
- `lib/pwa-lifecycle.ts` — pure install/update helpers used by hooks and tests.
- `public/sw.js` — conservative cache, update messages, Push display, and notification click handling.
- `public/offline.html` — public no-data offline fallback.
- `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`, `badge-96.png` — deterministic PWA assets.
- Co-located `*.test.mjs` files named in each task — Node tests and source-contract tests.

### Modify

- `app/layout.tsx` — manifest/icons/apple metadata and separate `viewport` export.
- `next.config.ts` — Service Worker headers and `web-push` server externalization.
- `proxy.ts` — bounded public-PWA matcher exclusions.
- `lib/web-auth-request.ts` — matching public-PWA request decisions.
- `lib/file-access.ts` — secret path denial before allowed-root checks.
- `app/api/files/[...path]/route.ts` — deny direct/session-reference access, hide list entries, and block uploads.
- `app/api/agent/running/events/route.ts` — connection ID and presence registration while preserving running frames.
- `lib/rpc-manager.ts` — consume settled cycles and invoke notifier asynchronously.
- `lib/pi-types.ts` — local event shape for runtime `willRetry`/settled events.
- `components/AppShell.tsx` — PWA banners, Push control, global presence owner, toast, and running-state wiring.
- `components/SessionSidebar.tsx` — consume parent running state and remove its EventSource.
- `package.json`, `package-lock.json`, `bun.lock` — Push dependencies and synchronized locks.
- `README.md`, `README.zh-CN.md`, `AGENTS.md` — deployment, browser, security, and maintenance documentation.

---

### Task 1: Publish PWA Assets Through the Application Gate

**Files:**
- Modify: `lib/web-auth-request.ts`
- Modify: `proxy.ts`
- Modify: `next.config.ts`
- Test: `lib/web-auth-request.test.mjs`
- Test: `lib/web-auth-proxy.test.mjs`
- Create: `lib/pwa-public.test.mjs`

**Interfaces:**
- Consumes: existing `isGatePublicPath(pathname)`, `decideGateRequest()`, Next `config.matcher`, and `nextConfig.headers()`.
- Produces: exact public path policy and `/sw.js` response headers; all `/api/push/*` paths remain protected.

- [ ] **Step 1: Extend request-policy tests before implementation**

Add these cases to `lib/web-auth-request.test.mjs`:

```js
test("publishes only exact PWA assets and the bounded icons prefix", () => {
  for (const path of [
    "/manifest.webmanifest",
    "/sw.js",
    "/offline.html",
    "/icons/icon-192.png",
    "/icons/nested/icon.png",
  ]) assert.equal(isGatePublicPath(path), true, path);

  for (const path of [
    "/manifestXwebmanifest",
    "/swXjs",
    "/offlineXhtml",
    "/icons",
    "/icons-private",
    "/api/push/status",
  ]) assert.equal(isGatePublicPath(path), false, path);
});

test("PWA assets remain public when gate configuration is broken", () => {
  for (const path of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-512.png"]) {
    assert.deepEqual(
      decideGateRequest(broken, { url: `http://localhost${path}`, method: "GET" }),
      { action: "allow", authStatus: "enabled" },
    );
  }
});
```

Update `lib/web-auth-proxy.test.mjs` with matcher assertions:

```js
test("matcher excludes bounded public PWA assets but not lookalikes", () => {
  for (const url of [
    "http://localhost/manifest.webmanifest",
    "http://localhost/sw.js",
    "http://localhost/offline.html",
    "http://localhost/icons/icon-192.png",
  ]) assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);

  for (const url of [
    "http://localhost/swXjs",
    "http://localhost/sw.js.map",
    "http://localhost/manifestXwebmanifest",
    "http://localhost/manifest.webmanifest.bak",
    "http://localhost/offline.htmlx",
    "http://localhost/icons",
    "http://localhost/icons-private",
    "http://localhost/api/push/status",
  ]) assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
});
```

Create `lib/pwa-public.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: nextConfig } = await jiti.import("../next.config.ts");

test("sw.js is revalidated and granted root scope", async () => {
  const rules = await nextConfig.headers();
  const sw = rules.find((rule) => rule.source === "/sw.js");
  assert.ok(sw);
  const headers = Object.fromEntries(sw.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers["cache-control"], "no-cache, max-age=0, must-revalidate");
  assert.equal(headers["service-worker-allowed"], "/");
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/web-auth-request.test.mjs lib/web-auth-proxy.test.mjs lib/pwa-public.test.mjs
```

Expected: FAIL because PWA paths are not public/excluded and `/sw.js` has no headers.

- [ ] **Step 3: Implement the exact bounded policy**

In `lib/web-auth-request.ts`, replace `isGatePublicPath` with:

```ts
export function isGatePublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/icons/");
}
```

Add `"/manifest.webmanifest"`, `"/sw.js"`, and `"/offline.html"` to `PUBLIC_PATHS`.

In `proxy.ts`, set:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|offline\\.html$|icons/).*)",
  ],
};
```

In `next.config.ts`, retain the `/` rule and add:

```ts
{
  source: "/sw.js",
  headers: [
    { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
    { key: "Service-Worker-Allowed", value: "/" },
  ],
},
{
  source: "/offline.html",
  headers: [
    { key: "Cache-Control", value: "public, no-cache, max-age=0, must-revalidate" },
  ],
},
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test lib/web-auth-request.test.mjs lib/web-auth-proxy.test.mjs lib/pwa-public.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all listed tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the public path boundary**

```bash
git add lib/web-auth-request.ts proxy.ts next.config.ts lib/web-auth-request.test.mjs lib/web-auth-proxy.test.mjs lib/pwa-public.test.mjs
git commit -m "feat: publish safe PWA assets"
```

---

### Task 2: Deny Push Secrets From Every File Access Path

**Files:**
- Create: `lib/push-paths.ts`
- Modify: `lib/file-access.ts`
- Modify: `app/api/files/[...path]/route.ts`
- Create: `lib/file-access-push-secrets.test.mjs`
- Create: `app/api/files/push-secrets.test.mjs`

**Interfaces:**
- Produces:

```ts
export const PUSH_STATE_FILE_NAME = "pi-web-push.json";
export const PUSH_TEMP_FILE_PREFIX = "pi-web-push.json.tmp-";
export function getPushStatePath(agentDir?: string): string;
export function isPushSecretPath(target: string, agentDir?: string): boolean;
export function isFilePathDenied(target: string, agentDir?: string): boolean;
export function isResolvedFilePathDenied(target: string, agentDir?: string): boolean;
```

- `isFilePathAllowed()` returns `false` for denied paths before checking roots.
- The files route checks raw and realpath denial before both root and session-reference authorization, filters denied children (including symlinks resolving to the state file) from lists, and rejects denied upload destinations.

- [ ] **Step 1: Write failing secret-path unit tests**

Create `lib/file-access-push-secrets.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import path from "node:path";

const jiti = createJiti(import.meta.url);
const paths = await jiti.import("./push-paths.ts");
const access = await jiti.import("./file-access.ts");
const agentDir = "/Users/example/.pi/agent";
const state = path.join(agentDir, "pi-web-push.json");

test("recognizes only the managed Push state file and atomic temp files", () => {
  assert.equal(paths.isPushSecretPath(state, agentDir), true);
  assert.equal(paths.isPushSecretPath(`${state}.tmp-abc`, agentDir), true);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "pi-web-push.json.bak"), agentDir), false);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "nested", "pi-web-push.json"), agentDir), false);
});

test("secret denial wins even when HOME or agent directory is an allowed root", () => {
  for (const roots of [new Set([agentDir]), new Set([path.dirname(agentDir)]), new Set(["/"])]) {
    assert.equal(access.isFilePathAllowed(state, roots, agentDir), false);
    assert.equal(access.isFilePathAllowed(`${state}.tmp-123`, roots, agentDir), false);
  }
  assert.equal(access.isFilePathAllowed(path.join(agentDir, "settings.json"), new Set([agentDir]), agentDir), true);
});
```

Create `app/api/files/push-secrets.test.mjs` as a route-order contract:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./[...path]/route.ts", import.meta.url), "utf8");

test("files route denies secrets before root and session-reference authorization", () => {
  const deny = source.indexOf("isResolvedFilePathDenied(filePath)");
  const root = source.indexOf("isFilePathAllowed(filePath, allowedRoots)");
  const reference = source.indexOf("isFilePathReferencedBySession(filePath, sessionId)");
  assert.ok(deny >= 0 && deny < root && deny < reference);
});

test("files route filters listings and upload destinations with the same deny helper", () => {
  assert.match(source, /isResolvedFilePathDenied\(path\.join\(filePath, d\.name\)\)/);
  assert.match(source, /isResolvedFilePathDenied\(destination\)/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/file-access-push-secrets.test.mjs app/api/files/push-secrets.test.mjs
```

Expected: FAIL because `push-paths.ts`, the deny helper, and route checks do not exist.

- [ ] **Step 3: Implement one canonical path rule**

Create `lib/push-paths.ts`:

```ts
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const PUSH_STATE_FILE_NAME = "pi-web-push.json";
export const PUSH_TEMP_FILE_PREFIX = `${PUSH_STATE_FILE_NAME}.tmp-`;

export function getPushStatePath(agentDir: string = getAgentDir()): string {
  return path.resolve(agentDir, PUSH_STATE_FILE_NAME);
}

export function isPushSecretPath(target: string, agentDir: string = getAgentDir()): boolean {
  const resolvedDir = path.resolve(agentDir);
  const resolvedTarget = path.resolve(target);
  if (path.dirname(resolvedTarget) !== resolvedDir) return false;
  const name = path.basename(resolvedTarget);
  return name === PUSH_STATE_FILE_NAME || name.startsWith(PUSH_TEMP_FILE_PREFIX);
}
```

In `lib/file-access.ts`, import `getAgentDir` and `isPushSecretPath`, add:

```ts
export function isFilePathDenied(target: string, agentDir: string = getAgentDir()): boolean {
  return isPushSecretPath(target, agentDir);
}

export function isResolvedFilePathDenied(target: string, agentDir: string = getAgentDir()): boolean {
  if (isFilePathDenied(target, agentDir)) return true;
  try {
    return isPushSecretPath(realpathSync(target), agentDir);
  } catch {
    return false;
  }
}
```

Change the signature and first line of `isFilePathAllowed`:

```ts
export function isFilePathAllowed(
  target: string,
  allowedRoots: Set<string>,
  agentDir?: string,
): boolean {
  if (isFilePathDenied(target, agentDir)) return false;
  // existing root loop follows unchanged
}
```

In `app/api/files/[...path]/route.ts`:

1. Import `isResolvedFilePathDenied`.
2. In `GET`, immediately after `filePath` is built, return 403 when `isResolvedFilePathDenied(filePath)` is true, before `getAllowedFileRoots()`.
3. In the directory filter, add `&& !isResolvedFilePathDenied(path.join(filePath, d.name))` so a symlink to the secret is hidden too.
4. In `POST`, after each `destination` is constructed and before conflict handling or writing, return/add a 403 error when `isResolvedFilePathDenied(destination)` is true.
5. For `upload-check`, reject any destination for which raw `isFilePathDenied(path.join(directory, name))` is true; for an existing conflict also apply `isResolvedFilePathDenied` before calling `inspectUploadTargets`.

Use `isFilePathAllowed()` for root authorization as today, but keep secret denial explicit at every sensitive boundary; also review `app/api/file-index/route.ts` and `app/api/worktrees/route.ts` in the final verification to confirm they cannot return or write file contents for the denied state path.

Use this exact response for direct denial:

```ts
NextResponse.json({ error: "Access denied" }, { status: 403 })
```

- [ ] **Step 4: Verify GREEN and existing file tests**

```bash
node --test lib/file-access-push-secrets.test.mjs app/api/files/push-secrets.test.mjs
node --test $(find lib app/api/files -name '*.test.mjs' -print)
node_modules/.bin/tsc --noEmit
```

Expected: all listed tests PASS; ordinary allowed files remain accessible.

- [ ] **Step 5: Commit the secret-file boundary**

```bash
git add lib/push-paths.ts lib/file-access.ts app/api/files/'[...path]'/route.ts lib/file-access-push-secrets.test.mjs app/api/files/push-secrets.test.mjs
git commit -m "fix: protect Push state from file access"
```

---

### Task 3: Add Manifest, Icons, Offline Fallback, and Conservative Service Worker

**Files:**
- Create: `app/manifest.ts`
- Modify: `app/layout.tsx`
- Create: `public/offline.html`
- Create: `public/sw.js`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/maskable-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Create: `public/icons/badge-96.png`
- Modify: `package.json`
- Create: `public/pwa-assets.test.mjs`
- Create: `public/sw-policy.test.mjs`

**Interfaces:**
- `app/manifest.ts` returns `MetadataRoute.Manifest` with root scope and standalone display.
- `app/layout.tsx` exports `metadata: Metadata` and separate `viewport: Viewport`.
- Initial `public/sw.js` handles install/activate/fetch/message only; Push handlers are added in Task 12.

- [ ] **Step 1: Write failing asset and policy tests**

Create `public/pwa-assets.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("manifest declares installable root-scoped assets", async () => {
  const { default: manifest } = await jiti.import("../app/manifest.ts");
  const value = manifest();
  assert.equal(value.name, "Pi Agent Web");
  assert.equal(value.short_name, "Pi Web");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.display, "standalone");
  assert.deepEqual(value.icons.map(({ src, sizes, purpose }) => ({ src, sizes, purpose })), [
    { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
    { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" },
  ]);
});

test("icons have exact dimensions and maskable art stays inside the safe square", () => {
  const script = `
import json
from PIL import Image
paths = {
  "icon-192.png": (192, 192), "icon-512.png": (512, 512),
  "maskable-512.png": (512, 512), "apple-touch-icon.png": (180, 180),
  "badge-96.png": (96, 96),
}
out = {}
for name, size in paths.items():
    im = Image.open("public/icons/" + name).convert("RGBA")
    assert im.size == size, (name, im.size)
    out[name] = {"size": im.size, "corner": im.getpixel((0, 0))}
print(json.dumps(out))
`;
  const result = JSON.parse(execFileSync("python3", ["-c", script], { encoding: "utf8" }));
  assert.deepEqual(result["maskable-512.png"].size, [512, 512]);
  assert.equal(result["maskable-512.png"].corner[3], 255);
  assert.ok(existsSync("public/offline.html"));
  assert.ok(readFileSync("public/offline.html", "utf8").includes("You are offline"));
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.files.includes("app/manifest.ts"));
});
```

Create `public/sw-policy.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("service worker precaches only public PWA resources", () => {
  assert.match(source, /"\/offline\.html"/);
  assert.match(source, /"\/manifest\.webmanifest"/);
  assert.match(source, /"\/icons\/icon-192\.png"/);
  assert.doesNotMatch(source, /_next\/static|\/api\/|\/login/);
});

test("only exact public PWA assets use Cache Storage", () => {
  assert.match(source, /PRECACHE_PATHS\.has\(url\.pathname\)/);
  assert.match(source, /caches\.match\(request\)/);
  assert.doesNotMatch(source, /cache\.put|caches\.open.*fetch/);
});

test("navigation fallback happens only on a rejected network request", () => {
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /fetch\(request\)\.catch/);
  assert.match(source, /new Response\([\s\S]*You are offline/);
  assert.doesNotMatch(source, /response\.status\s*===\s*(401|403|503)/);
});

test("waiting workers skip only after an explicit message", () => {
  assert.doesNotMatch(source.slice(source.indexOf('addEventListener("install"'), source.indexOf('addEventListener("activate"')), /skipWaiting/);
  assert.match(source, /data\?\.type === "SKIP_WAITING"/);
  assert.match(source, /self\.skipWaiting\(\)/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test public/pwa-assets.test.mjs public/sw-policy.test.mjs
```

Expected: FAIL because manifest, public directory, icons, offline fallback, and Service Worker do not exist.

- [ ] **Step 3: Generate real icons reproducibly**

Run this exact command:

```bash
mkdir -p public/icons
python3 - <<'PY'
from PIL import Image
src = Image.open("app/favicon.ico").convert("RGBA")
resample = Image.Resampling.LANCZOS
for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    src.resize((size, size), resample).save("public/icons/" + name)
mask = Image.new("RGBA", (512, 512), "#111827")
art = src.copy()
art.thumbnail((384, 384), resample)
mask.alpha_composite(art, ((512 - art.width) // 2, (512 - art.height) // 2))
mask.save("public/icons/maskable-512.png")
alpha = src.getchannel("A").resize((72, 72), resample)
badge = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
mark = Image.new("RGBA", (72, 72), (255, 255, 255, 255))
mark.putalpha(alpha)
badge.alpha_composite(mark, (12, 12))
badge.save("public/icons/badge-96.png")
PY
```

This creates a real 25% maskable margin rather than relabeling the normal icon.

- [ ] **Step 4: Implement manifest, metadata, fallback, and safe cache**

Create `app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pi Agent Web",
    short_name: "Pi Web",
    description: "Pi Coding Agent Web Interface",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#111827",
    theme_color: "#111827",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

In `app/layout.tsx`, import `Viewport`, extend metadata, and add the separate export:

```ts
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pi Agent Web",
  description: "Pi Coding Agent Web Interface",
  applicationName: "Pi Agent Web",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pi Web" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111827",
  colorScheme: "light dark",
};
```

Create `public/offline.html` as a self-contained static document containing only generic text: title `Pi Agent Web`, heading `You are offline`, and body `Reconnect to view sessions or control the Agent. An Agent already accepted by the server may still be running.` Do not include scripts, session data, or cached links other than `/`.

Create initial `public/sw.js`:

```js
"use strict";

const CACHE_PREFIX = "pi-web-public-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/badge-96.png",
];
const PRECACHE_PATHS = new Set(PRECACHE_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(async () =>
    (await caches.match("/offline.html")) || new Response(
      "<!doctype html><title>Pi Agent Web</title><h1>You are offline</h1><p>Reconnect to continue.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    )
  ));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

Add `"app/manifest.ts"` to the existing `package.json.files` array so `npm pack --dry-run` can audit the manifest source without requiring a fresh Next build.

- [ ] **Step 5: Verify GREEN**

```bash
node --test public/pwa-assets.test.mjs public/sw-policy.test.mjs
node --check public/sw.js
node_modules/.bin/tsc --noEmit
```

Expected: tests PASS, Service Worker parses, and TypeScript is clean.

- [ ] **Step 6: Commit PWA static assets**

```bash
git add app/manifest.ts app/layout.tsx package.json public
git commit -m "feat: add safe PWA foundation"
```

---

### Task 4: Register the Service Worker and Add Install, Update, and Offline UX

**Files:**
- Create: `lib/pwa-lifecycle.ts`
- Create: `hooks/useOnlineStatus.ts`
- Create: `hooks/usePwaInstall.ts`
- Create: `hooks/usePwaUpdate.ts`
- Create: `components/OfflineBanner.tsx`
- Create: `components/PwaInstallPrompt.tsx`
- Create: `components/PwaSettingsControl.tsx`
- Create: `components/PwaUpdateBanner.tsx`
- Modify: `components/AppShell.tsx`
- Create: `lib/pwa-lifecycle.test.mjs`
- Create: `components/AppShell.pwa.test.mjs`

**Interfaces:**

```ts
export type PwaControllerChange = "reload" | "prompt";
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean;
export function isStandaloneDisplay(matchesStandalone: boolean, navigatorStandalone?: boolean): boolean;
export function controllerChangeAction(reloadRequested: boolean): PwaControllerChange;

export function useOnlineStatus(): boolean;
export function usePwaInstall(): {
  canInstall: boolean; isIos: boolean; isStandalone: boolean; dismissed: boolean;
  promptInstall(): Promise<void>; dismiss(): void; resetDismissed(): void;
};
export function usePwaUpdate(): {
  updateAvailable: boolean; activatedElsewhere: boolean; applying: boolean;
  applyUpdate(): void;
};
```

- [ ] **Step 1: Write failing lifecycle and wiring tests**

Create `lib/pwa-lifecycle.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const pwa = await jiti.import("./pwa-lifecycle.ts");

test("detects iOS and standalone without treating ordinary Safari as installed", () => {
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", "iPhone", 5), true);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5), true);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0), false);
  assert.equal(pwa.isIosDevice("Mozilla/5.0 (Linux; Android 14) Chrome/123", "Linux armv8l", 5), false);
  assert.equal(pwa.isStandaloneDisplay(true, false), true);
  assert.equal(pwa.isStandaloneDisplay(false, true), true);
  assert.equal(pwa.isStandaloneDisplay(false, false), false);
});

test("only the tab that requested activation reloads on controllerchange", () => {
  assert.equal(pwa.controllerChangeAction(true), "reload");
  assert.equal(pwa.controllerChangeAction(false), "prompt");
});
```

Create `components/AppShell.pwa.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const update = readFileSync(new URL("../hooks/usePwaUpdate.ts", import.meta.url), "utf8");

test("AppShell mounts install, update, and offline UI", () => {
  for (const name of ["OfflineBanner", "PwaInstallPrompt", "PwaSettingsControl", "PwaUpdateBanner"]) {
    assert.match(shell, new RegExp(`<${name}`));
  }
  assert.match(shell, /Install help/);
});

test("update hook registers root sw and reloads only with a tab-local request", () => {
  assert.match(update, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(update, /reloadRequestedRef\.current/);
  assert.match(update, /controllerChangeAction\(reloadRequestedRef\.current\)/);
  assert.match(update, /if \(activatedElsewhere\)[\s\S]*window\.location\.reload\(\)/);
  assert.doesNotMatch(update, /localStorage.*reloadRequested/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/pwa-lifecycle.test.mjs components/AppShell.pwa.test.mjs
```

Expected: FAIL because lifecycle helpers, hooks, components, and AppShell mounts do not exist.

- [ ] **Step 3: Implement pure lifecycle helpers and browser hooks**

Create `lib/pwa-lifecycle.ts`:

```ts
export type PwaControllerChange = "reload" | "prompt";
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}
export function isStandaloneDisplay(matchesStandalone: boolean, navigatorStandalone = false): boolean {
  return matchesStandalone || navigatorStandalone;
}
export function controllerChangeAction(reloadRequested: boolean): PwaControllerChange {
  return reloadRequested ? "reload" : "prompt";
}
```

Create `hooks/useOnlineStatus.ts` using `navigator.onLine` as initial state and `online`/`offline` listeners.

Create `hooks/usePwaInstall.ts` with a local `BeforeInstallPromptEvent` interface, storage key `pi-web:pwa-install-dismissed`, and these rules:

- capture `beforeinstallprompt` and call `preventDefault()`;
- do not call `.prompt()` until `promptInstall()` is invoked;
- derive iOS/iPadOS (including desktop-style iPad user agents) and standalone through `pwa-lifecycle.ts`;
- hide when standalone or dismissed;
- `dismiss()` writes `"1"`; `resetDismissed()` removes it.

Create `hooks/usePwaUpdate.ts` with this exact control flow:

```ts
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const reloadRequestedRef = useRef(false);
const waitingRef = useRef<ServiceWorker | null>(null);

// mount effect:
// 1. navigator.serviceWorker.register("/sw.js", { scope: "/" })
// 2. offer registration.waiting only when navigator.serviceWorker.controller exists
// 3. on updatefound/statechange, offer an installed worker only when an old controller exists
// 4. on controllerchange:
const action = controllerChangeAction(reloadRequestedRef.current);
if (action === "reload") window.location.reload();
else { setActivatedElsewhere(true); setUpdateAvailable(true); }
// 5. registration.update() on visibility becoming visible and every UPDATE_CHECK_MS

const applyUpdate = () => {
  if (activatedElsewhere) {
    window.location.reload();
    return;
  }
  const waiting = waitingRef.current;
  if (!waiting) return;
  reloadRequestedRef.current = true;
  setApplying(true);
  waiting.postMessage({ type: "SKIP_WAITING" });
};
```

Cleanup all listeners and intervals. Never persist `reloadRequestedRef` outside the tab.

- [ ] **Step 4: Implement focused UI and mount it in AppShell**

Create:

- `OfflineBanner`: render nothing online; offline render a top-centered banner saying `Offline — Agent and session controls require a network connection. Showing last known state.`
- `PwaInstallPrompt`: Chromium button calls `promptInstall`; iOS non-standalone text says `Share → Add to Home Screen`; dismissal is explicit.
- `PwaSettingsControl`: when non-standalone, always render a compact `Install help` action that calls `resetDismissed()`; hide it in standalone mode.
- `PwaUpdateBanner`: text distinguishes `updateAvailable` from `activatedElsewhere`; its button calls `applyUpdate`; if any `runningSessionIds.size > 0`, say the server Agent keeps running but the page reconnects.

In `AppShell.tsx`, call `useOnlineStatus`, `usePwaInstall`, and `usePwaUpdate` once at the component root and mount the four components at shell level, outside chat/sidebar scroll containers. Pass the current running set temporarily as an empty set; Task 14 replaces it with live global state. Do not change `SessionSidebar` or its EventSource in this task.

- [ ] **Step 5: Verify GREEN**

```bash
node --test lib/pwa-lifecycle.test.mjs components/AppShell.pwa.test.mjs
node_modules/.bin/tsc --noEmit
npx eslint lib/pwa-lifecycle.ts hooks/useOnlineStatus.ts hooks/usePwaInstall.ts hooks/usePwaUpdate.ts components/OfflineBanner.tsx components/PwaInstallPrompt.tsx components/PwaSettingsControl.tsx components/PwaUpdateBanner.tsx components/AppShell.tsx
```

Expected: tests PASS, typecheck and changed-file lint PASS.

- [ ] **Step 6: Commit install/update/offline UX**

```bash
git add lib/pwa-lifecycle.ts lib/pwa-lifecycle.test.mjs hooks/useOnlineStatus.ts hooks/usePwaInstall.ts hooks/usePwaUpdate.ts components/OfflineBanner.tsx components/PwaInstallPrompt.tsx components/PwaSettingsControl.tsx components/PwaUpdateBanner.tsx components/AppShell.tsx components/AppShell.pwa.test.mjs
git commit -m "feat: add PWA lifecycle UX"
```

### Task 5: Define and Validate Versioned Notification Payloads

**Files:**
- Create: `lib/push-types.ts`
- Create: `lib/push-types.test.mjs`

**Interfaces:**

```ts
export type AgentNotificationResult = "success" | "error";
export type AgentNotificationPayloadV1 = {
  version: 1; id: string; kind: "agent"; sessionId: string; result: AgentNotificationResult;
};
export type TestNotificationPayloadV1 = {
  version: 1; id: string; kind: "test";
};
export type NotificationPayloadV1 = AgentNotificationPayloadV1 | TestNotificationPayloadV1;
export type NotificationPresentation = {
  title: "Pi Agent Web"; body: string; tag: string; url: string;
};
export function parseNotificationPayload(value: unknown): NotificationPayloadV1 | null;
export function getNotificationPresentation(payload: NotificationPayloadV1): NotificationPresentation;
export type RunningEventsMessage =
  | { type: "connected"; connectionId: string }
  | { type: "running"; runningSessionIds: string[] }
  | { type: "notification"; notification: AgentNotificationPayloadV1 };
```

- [ ] **Step 1: Write failing payload tests**

Create `lib/push-types.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const push = await jiti.import("./push-types.ts");

test("accepts only the two version 1 discriminated payload branches", () => {
  assert.deepEqual(push.parseNotificationPayload({
    version: 1, id: "n1", kind: "agent", sessionId: "s/a", result: "success",
  }), { version: 1, id: "n1", kind: "agent", sessionId: "s/a", result: "success" });
  assert.deepEqual(push.parseNotificationPayload({ version: 1, id: "n2", kind: "test" }), {
    version: 1, id: "n2", kind: "test",
  });
  for (const invalid of [
    null,
    { version: 2, id: "n", kind: "test" },
    { version: 1, id: "", kind: "test" },
    { version: 1, id: "n", kind: "agent", result: "success" },
    { version: 1, id: "n", kind: "agent", sessionId: "s", result: "aborted" },
    { version: 1, id: "n", kind: "test", url: "https://evil.example" },
    { version: 1, id: "n", kind: "agent", sessionId: "s", result: "success", title: "secret" },
  ]) assert.equal(push.parseNotificationPayload(invalid), null, JSON.stringify(invalid));
});

test("derives fixed copy, tags, and same-origin relative URLs locally", () => {
  assert.deepEqual(push.getNotificationPresentation({
    version: 1, id: "n1", kind: "agent", sessionId: "a/b?c", result: "error",
  }), {
    title: "Pi Agent Web",
    body: "Agent run failed",
    tag: "pi-web-agent-a%2Fb%3Fc-error",
    url: "/?session=a%2Fb%3Fc",
  });
  assert.deepEqual(push.getNotificationPresentation({ version: 1, id: "n2", kind: "test" }), {
    title: "Pi Agent Web",
    body: "Test notification delivered",
    tag: "pi-web-test",
    url: "/",
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-types.test.mjs
```

Expected: FAIL because `lib/push-types.ts` does not exist.

- [ ] **Step 3: Implement strict parsing and local presentation**

Create `lib/push-types.ts` with the interfaces above and this parser shape:

```ts
const ownKeysEqual = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function parseNotificationPayload(value: unknown): NotificationPayloadV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !boundedText(item.id, 128)) return null;
  if (item.kind === "test") {
    return ownKeysEqual(item, ["version", "id", "kind"])
      ? { version: 1, id: item.id, kind: "test" }
      : null;
  }
  if (item.kind === "agent") {
    if (!ownKeysEqual(item, ["version", "id", "kind", "sessionId", "result"])) return null;
    if (!boundedText(item.sessionId, 256)) return null;
    if (item.result !== "success" && item.result !== "error") return null;
    return { version: 1, id: item.id, kind: "agent", sessionId: item.sessionId, result: item.result };
  }
  return null;
}

export function getNotificationPresentation(payload: NotificationPayloadV1): NotificationPresentation {
  if (payload.kind === "test") {
    return { title: "Pi Agent Web", body: "Test notification delivered", tag: "pi-web-test", url: "/" };
  }
  const encoded = encodeURIComponent(payload.sessionId);
  return {
    title: "Pi Agent Web",
    body: payload.result === "success" ? "Agent run finished" : "Agent run failed",
    tag: `pi-web-agent-${encoded}-${payload.result}`,
    url: `/?session=${encoded}`,
  };
}
```

Export the types exactly as declared in **Interfaces**. Extra server-provided keys are rejected so title/body/tag/URL cannot enter either rendering path.

- [ ] **Step 4: Verify GREEN**

```bash
node --test lib/push-types.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: payload tests PASS and TypeScript is clean.

- [ ] **Step 5: Commit shared notification contracts**

```bash
git add lib/push-types.ts lib/push-types.test.mjs
git commit -m "feat: define safe Push payloads"
```

---

### Task 6: Add Push Configuration and Runtime Dependencies

**Files:**
- Create: `lib/push-config.ts`
- Create: `lib/push-config.test.mjs`
- Modify: `next.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bun.lock`
- Create: `lib/push-dependencies.test.mjs`

**Interfaces:**

```ts
export type PushConfig =
  | { status: "enabled"; configPath: string; subject: string }
  | { status: "disabled"; configPath: string }
  | { status: "error"; configPath: string; code: "PUSH_CONFIG_ERROR"; logMessage: string };
export type ReadPushConfigOptions = {
  env?: NodeJS.ProcessEnv; configPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
};
export function readPushConfig(options?: ReadPushConfigOptions): PushConfig;
```

- [ ] **Step 1: Write failing config and dependency tests**

Create `lib/push-config.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readPushConfig } = await jiti.import("./push-config.ts");
const configPath = "/tmp/pi-web.json";
const readJson = (value) => () => JSON.stringify(value);
const missing = () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; };

test("defaults Push to enabled with the project HTTPS subject", () => {
  assert.deepEqual(readPushConfig({ configPath, env: {}, readFile: missing }), {
    status: "enabled", configPath, subject: "https://github.com/agegr/pi-web",
  });
});

test("environment overrides file Push settings field by field", () => {
  assert.deepEqual(readPushConfig({
    configPath,
    env: { PI_WEB_PUSH_DISABLED: "false", PI_WEB_PUSH_SUBJECT: "mailto:env@example.com" },
    readFile: readJson({ push: { disabled: true, subject: "https://file.example" } }),
  }), { status: "enabled", configPath, subject: "mailto:env@example.com" });
});

test("explicit disable and invalid values do not affect ordinary gate parsing", () => {
  assert.deepEqual(readPushConfig({
    configPath, env: {}, readFile: readJson({ auth: { password: "secret" }, push: { disabled: true } }),
  }), { status: "disabled", configPath });
  for (const options of [
    { env: { PI_WEB_PUSH_DISABLED: "yes" }, readFile: missing },
    { env: { PI_WEB_PUSH_SUBJECT: "ftp://bad.example" }, readFile: missing },
    { env: {}, readFile: readJson({ push: { disabled: "false" } }) },
    { env: {}, readFile: readJson({ push: { subject: 3 } }) },
  ]) assert.equal(readPushConfig({ configPath, ...options }).status, "error");
});
```

Create `lib/push-dependencies.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("web-push ships as a runtime dependency with declarations", () => {
  assert.equal(pkg.dependencies["web-push"], "3.6.7");
  assert.equal(pkg.devDependencies["@types/web-push"], "3.6.4");
  assert.match(config, /"web-push"/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-config.test.mjs lib/push-dependencies.test.mjs
```

Expected: FAIL because configuration and dependencies do not exist.

- [ ] **Step 3: Install exact dependencies and synchronize both locks**

```bash
npm install --save-exact web-push@3.6.7
npm install --save-dev --save-exact @types/web-push@3.6.4
bun install --lockfile-only
```

Confirm `package.json` contains exact versions, `package-lock.json` contains `node_modules/web-push`, and `bun.lock` contains `web-push@3.6.7`.

Add `"web-push"` to `next.config.ts` `serverExternalPackages` so Next does not bundle its Node TLS implementation.

- [ ] **Step 4: Implement strict independent Push configuration**

Create `lib/push-config.ts`. Reuse `getWebAuthConfigPath()` only for the path; parse the file independently so invalid Push fields lock Push without changing the existing gate module:

```ts
import { readFileSync } from "node:fs";
import { getWebAuthConfigPath } from "./web-auth-config";

const DEFAULT_SUBJECT = "https://github.com/agegr/pi-web";
function parseBoolean(value: string | undefined): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  return "invalid";
}
function validSubject(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "mailto:" || url.protocol === "https:";
  } catch { return false; }
}
```

`readPushConfig()` must:

1. parse only top-level `push` as `{disabled?: boolean, subject?: string}`;
2. treat ENOENT as empty configuration;
3. return `PUSH_CONFIG_ERROR` for malformed JSON, non-object root/push, wrong types, invalid env boolean, or invalid subject;
4. use env > file > defaults;
5. return disabled before requiring a subject;
6. never include file contents or subject secrets in a browser response; `logMessage` remains server-only.

- [ ] **Step 5: Verify GREEN**

```bash
node --test lib/push-config.test.mjs lib/push-dependencies.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: tests PASS and TypeScript is clean.

- [ ] **Step 6: Commit configuration and dependencies**

```bash
git add lib/push-config.ts lib/push-config.test.mjs lib/push-dependencies.test.mjs next.config.ts package.json package-lock.json bun.lock
git commit -m "feat: configure Web Push runtime"
```

---

### Task 7: Persist VAPID Keys and Authorized Subscriptions Safely

**Files:**
- Create: `lib/push-store.ts`
- Create: `lib/push-store.test.mjs`

**Interfaces:**

```ts
export type VapidKeys = { publicKey: string; privateKey: string };
export type StoredPushSubscription = {
  endpoint: string; p256dh: string; auth: string; createdAt: string; authFingerprint: string;
};
export type PushStateFile = { version: 1; vapid: VapidKeys; subscriptions: StoredPushSubscription[] };
export type BrowserPushSubscription = { endpoint: string; p256dh: string; auth: string };
export type PushStoreOptions = {
  statePath?: string;
  now?: () => Date;
  generateVapidKeys?: () => VapidKeys;
};
export class PushStoreLockedError extends Error { readonly code = "PUSH_STORE_LOCKED"; }
export function computeAuthFingerprint(password: string, vapidPrivateKey: string): string;
export class PushStore {
  constructor(options?: PushStoreOptions);
  getVapidKeys(): Promise<VapidKeys>;
  getPublicKey(): Promise<string>;
  upsert(subscription: BrowserPushSubscription, password: string): Promise<"created" | "updated" | "limit">;
  remove(endpoint: string, password: string): Promise<boolean>;
  findAuthorized(endpoint: string, password: string): Promise<StoredPushSubscription | null>;
  listAuthorized(password: string): Promise<StoredPushSubscription[]>;
  removeEndpoint(endpoint: string): Promise<void>;
}
export function getPushStore(): PushStore;
```

`PushStoreOptions` injects `statePath`, `now`, and `generateVapidKeys` for deterministic tests; persistence itself uses the real temporary filesystem so atomic-write behavior is exercised.

- [ ] **Step 1: Write failing persistence tests**

Create `lib/push-store.test.mjs` using a real temporary directory and injected VAPID keys:

```js
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const mod = await jiti.import("./push-store.ts");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "pi-push-store-")); dirs.push(dir);
  const statePath = join(dir, "pi-web-push.json");
  const store = new mod.PushStore({
    statePath,
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    generateVapidKeys: () => ({ publicKey: "public-key", privateKey: "private-key" }),
  });
  return { dir, statePath, store };
}

test("first load creates stable 0600 VAPID state through an atomic temp rename", async () => {
  const { dir, statePath, store } = makeStore();
  assert.deepEqual(await store.getVapidKeys(), { publicKey: "public-key", privateKey: "private-key" });
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual((await new mod.PushStore({ statePath }).getVapidKeys()), {
    publicKey: "public-key", privateKey: "private-key",
  });
  assert.equal(readFileSync(statePath, "utf8").includes("private-key"), true);
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes(".tmp-")), []);
});

test("same endpoint is globally updated and rebound without consuming a slot", async () => {
  const { store } = makeStore();
  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k1", auth: "a1" }, "old"), "created");
  assert.equal(await store.upsert({ endpoint: "https://push.example/a", p256dh: "k2", auth: "a2" }, "new"), "updated");
  assert.equal((await store.listAuthorized("old")).length, 0);
  assert.ok(await store.findAuthorized("https://push.example/a", "new"));
  const current = await store.findAuthorized("https://push.example/a", "new");
  assert.equal(current.p256dh, "k2");
});

test("twenty endpoints are retained and the twenty-first returns limit", async () => {
  const { store } = makeStore();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.upsert({
    endpoint: `https://push.example/${i}`, p256dh: `k${i}`, auth: `a${i}`,
  }, "secret")));
  assert.equal((await store.listAuthorized("secret")).length, 20);
  assert.equal(await store.upsert({ endpoint: "https://push.example/20", p256dh: "k", auth: "a" }, "secret"), "limit");
});

test("corrupt state locks Push and is never overwritten", async () => {
  const { statePath, store } = makeStore();
  writeFileSync(statePath, "{broken", { mode: 0o600 });
  await assert.rejects(store.getPublicKey(), (error) => error.code === "PUSH_STORE_LOCKED");
  assert.equal(readFileSync(statePath, "utf8"), "{broken");
});

test("serialized concurrent mutations do not lose subscriptions", async () => {
  const { store } = makeStore();
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.upsert({
    endpoint: `https://push.example/${i}`, p256dh: `k${i}`, auth: `a${i}`,
  }, "secret")));
  assert.equal((await store.listAuthorized("secret")).length, 12);
});
```

Also test `computeAuthFingerprint("secret", "private-key")` against a value independently computed with `createHmac("sha256", "private-key").update("pi-web-push-auth-v1").update("\0").update("secret").digest("base64url")`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-store.test.mjs
```

Expected: FAIL because the Push store does not exist.

- [ ] **Step 3: Implement locked loading and serialized atomic mutations**

Create `lib/push-store.ts` using `node:fs/promises`, `randomUUID`, `createHmac`, `getPushStatePath()`, and `web-push.generateVAPIDKeys()`.

Use clone-on-write so a failed persist cannot corrupt the in-memory state:

```ts
export class PushStore {
  private state: PushStateFile | null = null;
  private loading: Promise<PushStateFile> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  private async load(): Promise<PushStateFile> {
    if (this.state) return this.state;
    this.loading ??= this.loadOrCreate();
    this.state = await this.loading;
    return this.state;
  }

  private async mutate<T>(fn: (draft: PushStateFile) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.mutationQueue.then(async () => {
      const base = await this.load();
      const draft = structuredClone(base);
      result = await fn(draft);
      await this.persist(draft);
      this.state = draft;
    });
    this.mutationQueue = operation.catch(() => {});
    await operation;
    return result;
  }
}
```

Place the fingerprint helper immediately before the class:

```ts
export function computeAuthFingerprint(password: string, vapidPrivateKey: string): string {
  return createHmac("sha256", vapidPrivateKey)
    .update("pi-web-push-auth-v1").update("\0").update(password).digest("base64url");
}
```

`loadOrCreate()` must:

- read and strictly validate version, string VAPID keys, array subscription records, valid ISO dates, and no duplicate endpoint;
- on ENOENT generate VAPID keys and persist an empty state;
- on every other read/parse/validation error throw `PushStoreLockedError` and retain the original file;
- `chmod(statePath, 0o600)` after successfully loading an existing valid file.

`persist()` must:

```ts
const temp = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(temp, 0o600);
try { await rename(temp, statePath); await chmod(statePath, 0o600); }
catch (error) { await unlink(temp).catch(() => {}); throw error; }
```

For `upsert`, locate endpoint before enforcing the limit. Existing endpoint replaces keys, fingerprint, and `createdAt`; new endpoint checks `subscriptions.length >= 20`. `listAuthorized(password)` uses the serialized clone-on-write mutation path: return matching records and remove nonmatching password-epoch records in the same persisted mutation before resolving. `remove()` checks both endpoint and current fingerprint. `removeEndpoint()` is reserved for 404/410 cleanup and ignores fingerprint.

Export a `globalThis.__piPushStore` singleton from `getPushStore()` so Next hot reload does not create competing write queues.

- [ ] **Step 4: Verify GREEN**

```bash
node --test lib/push-store.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all store tests PASS with no leftover temp files.

- [ ] **Step 5: Commit the Push store**

```bash
git add lib/push-store.ts lib/push-store.test.mjs
git commit -m "feat: persist authorized Push subscriptions"
```

---

### Task 8: Validate Subscriptions and Bind DNS Checks to the Actual Socket

**Files:**
- Create: `lib/push-target.ts`
- Create: `lib/push-target.test.mjs`

**Interfaces:**

```ts
export type ValidatedSubscription = { endpoint: string; p256dh: string; auth: string };
export function validatePushSubscription(value: unknown): ValidatedSubscription;
export function isPublicPushAddress(address: string, family: 4 | 6): boolean;
export type ResolveAll = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;
export function createValidatedLookup(resolveAll?: ResolveAll): import("node:net").LookupFunction;
export function createPushHttpsAgent(resolveAll?: ResolveAll): import("node:https").Agent;
```

Validation errors have `code = "PUSH_INVALID_SUBSCRIPTION"`; DNS policy errors have `code = "PUSH_UNSAFE_ENDPOINT"`.

- [ ] **Step 1: Write failing subscription and DNS tests**

Create `lib/push-target.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const target = await jiti.import("./push-target.ts");
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const auth = Buffer.alloc(16, 2).toString("base64url");

test("accepts only exact HTTPS endpoint and decoded key shapes", () => {
  assert.deepEqual(target.validatePushSubscription({
    endpoint: "https://push.example/v1/send/abc", keys: { p256dh, auth },
  }), { endpoint: "https://push.example/v1/send/abc", p256dh, auth });
  for (const value of [
    { endpoint: "http://push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://user:pass@push.example/a", keys: { p256dh, auth } },
    { endpoint: "https://127.0.0.1/a", keys: { p256dh, auth } },
    { endpoint: "https://localhost/a", keys: { p256dh, auth } },
    { endpoint: `https://${"a".repeat(4090)}.example/a`, keys: { p256dh, auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: p256dh + "=", auth } },
    { endpoint: "https://push.example/a", keys: { p256dh: Buffer.alloc(65).toString("base64url"), auth } },
    { endpoint: "https://push.example/a", keys: { p256dh, auth: "short" } },
  ]) assert.throws(() => target.validatePushSubscription(value), (error) => error.code === "PUSH_INVALID_SUBSCRIPTION");
});

test("classifies private, local, mapped, and public addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1"]) {
    assert.equal(target.isPublicPushAddress(address, 4), false, address);
  }
  for (const address of ["::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(target.isPublicPushAddress(address, 6), false, address);
  }
  assert.equal(target.isPublicPushAddress("8.8.8.8", 4), true);
  assert.equal(target.isPublicPushAddress("2606:4700:4700::1111", 6), true);
});

function callLookup(lookup, hostname) {
  return new Promise((resolve, reject) => lookup(hostname, { all: false }, (error, address, family) =>
    error ? reject(error) : resolve({ address, family })
  ));
}

test("actual-socket lookup rejects empty and mixed result sets", async () => {
  await assert.rejects(callLookup(target.createValidatedLookup(async () => []), "push.example"), /unsafe|resolve/i);
  await assert.rejects(callLookup(target.createValidatedLookup(async () => [
    { address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 },
  ]), "push.example"), /unsafe/i);
  assert.deepEqual(await callLookup(target.createValidatedLookup(async () => [
    { address: "2606:4700:4700::1111", family: 6 }, { address: "8.8.8.8", family: 4 },
  ]), "push.example"), { address: "2606:4700:4700::1111", family: 6 });
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-target.test.mjs
```

Expected: FAIL because target validation and custom lookup do not exist.

- [ ] **Step 3: Implement field validation and IP policy**

In `validatePushSubscription()`:

- require a plain object with exactly `endpoint` and `keys`, and keys exactly `p256dh`/`auth`;
- enforce HTTPS, no username/password, UTF-8 endpoint length <= 4096;
- reject `localhost`, `.localhost`, and all IP-literal hostnames;
- enforce `/^[A-Za-z0-9_-]+$/`, exact character lengths, decoded lengths, and `p256dh[0] === 0x04`;
- normalize and return only the three strings.

Implement public address policy with `node:net.isIP` plus explicit helpers. IPv4 denies `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/4`, and `240/4`. IPv6 denies unspecified/loopback, `fc00::/7`, `fe80::/10`, multicast `ff00::/8`; when the lowercase address begins `::ffff:`, extract the final dotted IPv4 or final 32 bits and apply IPv4 policy.

- [ ] **Step 4: Implement an actual-socket custom lookup**

Default resolution uses:

```ts
const defaultResolveAll: ResolveAll = (hostname) => new Promise((resolve, reject) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) reject(error);
    else resolve(addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 })));
  });
});
```

`createValidatedLookup(resolveAll)` returns a callback-style lookup function. It must resolve all addresses for the hostname at the moment `https.request` opens the socket, reject the whole set if empty or any entry is nonpublic, and return exactly the first validated `{address, family}` through the callback. It must not return a separately pre-resolved hostname.

`createPushHttpsAgent()` returns:

```ts
new https.Agent({ keepAlive: false, maxSockets: 8, lookup: createValidatedLookup(resolveAll) });
```

TLS continues to receive the original endpoint hostname, so Host/SNI/certificate validation are preserved.

- [ ] **Step 5: Verify GREEN**

```bash
node --test lib/push-target.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: validation and DNS tests PASS.

- [ ] **Step 6: Commit target hardening**

```bash
git add lib/push-target.ts lib/push-target.test.mjs
git commit -m "feat: harden Web Push targets"
```

---

### Task 9: Centralize Push API Request Security

**Files:**
- Create: `lib/push-request.ts`
- Create: `lib/push-request.test.mjs`

**Interfaces:**

```ts
export const PUSH_BODY_LIMIT_BYTES = 16 * 1024;
export type EnabledPushRequest = { password: string };
export function requireEnabledPushRequest(request: Request, config?: GateConfig): EnabledPushRequest | Response;
export function readPushJsonBody(request: Request): Promise<unknown | Response>;
export function pushJson(body: unknown, init?: { status?: number }): Response;
export function pushError(status: number, code: string, error: string): Response;
export function isResponse(value: unknown): value is Response;
```

- [ ] **Step 1: Write failing request-security tests**

Create `lib/push-request.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const request = await jiti.import("./push-request.ts");

function post(body, headers = {}) {
  return new Request("https://pi.example/api/push/test", {
    method: "POST",
    headers: { origin: "https://pi.example", "content-type": "application/json", "x-pi-web-auth-status": "enabled", ...headers },
    body,
  });
}

test("reads same-origin bounded JSON and returns no-store responses", async () => {
  assert.deepEqual(await request.readPushJsonBody(post('{"ok":true}')), { ok: true });
  const response = request.pushJson({ ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects origin, media type, malformed JSON, and bodies over 16 KiB", async () => {
  const cases = [
    [post("{}", { origin: "https://evil.example" }), 403, "PUSH_ORIGIN_MISMATCH"],
    [post("{}", { "content-type": "text/plain" }), 415, "PUSH_JSON_REQUIRED"],
    [post("{broken"), 400, "PUSH_INVALID_BODY"],
    [post(JSON.stringify({ value: "x".repeat(17 * 1024) })), 413, "PUSH_BODY_TOO_LARGE"],
  ];
  for (const [input, status, code] of cases) {
    const result = await request.readPushJsonBody(input);
    assert.equal(result.status, status);
    assert.equal((await result.json()).code, code);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
});
```

Add injected-config tests for `requireEnabledPushRequest` using its optional second `GateConfig` parameter:

```js
test("requires both enabled gate config and the proxy-authenticated header", async () => {
  const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
  assert.deepEqual(request.requireEnabledPushRequest(post("{}"), enabled), { password: "secret" });
  for (const config of [
    { status: "disabled", configPath: "/tmp/pi-web.json" },
    { status: "unconfigured", configPath: "/tmp/pi-web.json" },
    { status: "error", configPath: "/tmp/pi-web.json", logMessage: "bad" },
  ]) assert.ok(request.requireEnabledPushRequest(post("{}"), config) instanceof Response);
  assert.ok(request.requireEnabledPushRequest(post("{}", { "x-pi-web-auth-status": "disabled" }), enabled) instanceof Response);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-request.test.mjs
```

Expected: FAIL because request helpers do not exist.

- [ ] **Step 3: Implement the shared API boundary**

`pushJson()` and `pushError()` always set `Cache-Control: no-store` and `Content-Type: application/json`.

`requireEnabledPushRequest(request, config = readGateConfig())` must:

- return 503 `PUSH_AUTH_CONFIG_ERROR` for unconfigured/error (log `logMessage` server-side only for error);
- return 403 `PUSH_GATE_REQUIRED` for disabled;
- return 401 `PUSH_UNAUTHORIZED` unless header `x-pi-web-auth-status` is exactly `enabled`;
- return only `{password}` on success.

`readPushJsonBody()` must check in this order:

1. `new URL(request.url).origin === request.headers.get("origin")`;
2. media type before `;` equals `application/json` case-insensitively;
3. numeric content-length, if present, is <= 16384;
4. `await request.arrayBuffer()` length <= 16384;
5. UTF-8 decode and `JSON.parse`.

Return the exact error codes from the tests and never include parser text.

Use this exact bounded read:

```ts
const contentLength = request.headers.get("content-length");
if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > PUSH_BODY_LIMIT_BYTES)) {
  return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
}
const bytes = new Uint8Array(await request.arrayBuffer());
if (bytes.byteLength > PUSH_BODY_LIMIT_BYTES) {
  return pushError(413, "PUSH_BODY_TOO_LARGE", "Push request body is too large");
}
```

Then decode with `new TextDecoder("utf-8", { fatal: true })`; decoding or JSON errors return `400 PUSH_INVALID_BODY` without parser details.

- [ ] **Step 4: Verify GREEN**

```bash
node --test lib/push-request.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: request-security tests PASS.

- [ ] **Step 5: Commit request helpers**

```bash
git add lib/push-request.ts lib/push-request.test.mjs
git commit -m "feat: secure Push API requests"
```

---

### Task 10: Deliver Push Messages With Bounded Failure Handling

**Files:**
- Create: `lib/push-service.ts`
- Create: `lib/push-service.test.mjs`

**Interfaces:**

```ts
export type PushDeliveryStatus = "sent" | "gone" | "auth_error" | "temporary" | "invalid_target" | "error";
export type PushDeliveryResult = { endpointHost: string; status: PushDeliveryStatus };
export type PushSendSummary = { attempted: number; sent: number; results: PushDeliveryResult[] };
export class PushService {
  constructor(options?: PushServiceOptions);
  send(payload: NotificationPayloadV1, password: string, endpoint?: string): Promise<PushSendSummary>;
}
export function getPushService(): PushService;
```

`PushServiceOptions` injects store, config reader, `web-push` client, and HTTPS Agent for real behavior tests without network calls.

- [ ] **Step 1: Write failing send-semantics tests**

Create `lib/push-service.test.mjs` with a fake store and fake `web-push` client:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { PushService } = await jiti.import("./push-service.ts");

function fixture(outcomes = {}) {
  const removed = [];
  const calls = [];
  const validP256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
  const validAuth = Buffer.alloc(16, 2).toString("base64url");
  const subscriptions = ["ok", "gone", "busy"].map((id) => ({
    endpoint: `https://push.example/${id}`, p256dh: validP256dh, auth: validAuth, createdAt: "x", authFingerprint: "fp",
  }));
  const store = {
    getVapidKeys: async () => ({ publicKey: "public", privateKey: "private" }),
    listAuthorized: async () => subscriptions,
    removeEndpoint: async (endpoint) => removed.push(endpoint),
  };
  const client = {
    setVapidDetails: (...args) => calls.push(["vapid", ...args]),
    sendNotification: async (subscription, payload, options) => {
      calls.push(["send", subscription, JSON.parse(payload), options]);
      const outcome = outcomes[subscription.endpoint];
      if (outcome) throw Object.assign(new Error("send failed"), { statusCode: outcome });
      return { statusCode: 201 };
    },
  };
  const agent = { marker: "validated-agent" };
  const service = new PushService({
    store, client, agent,
    readConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
  });
  return { service, calls, removed, agent };
}

test("passes fixed timeout, TTL, custom agent, and no proxy", async () => {
  const { service, calls, agent } = fixture();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(summary.attempted, 3);
  assert.equal(summary.sent, 3);
  const sends = calls.filter(([kind]) => kind === "send");
  for (const [, , payload, options] of sends) {
    assert.deepEqual(payload, { version: 1, id: "n", kind: "test" });
    assert.equal(options.TTL, 300);
    assert.equal(options.timeout, 10_000);
    assert.equal(options.agent, agent);
    assert.equal("proxy" in options, false);
  }
});

test("isolates failures and deletes only 404 or 410 endpoints", async () => {
  const { service, removed } = fixture({
    "https://push.example/gone": 410,
    "https://push.example/busy": 503,
  });
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(summary.sent, 1);
  assert.deepEqual(removed, ["https://push.example/gone"]);
  assert.deepEqual(summary.results.map((item) => item.status).sort(), ["gone", "sent", "temporary"]);
});

test("test delivery is restricted to an authorized stored endpoint", async () => {
  const { service, calls } = fixture();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret", "https://push.example/ok");
  assert.equal(summary.attempted, 1);
  assert.equal(calls.filter(([kind]) => kind === "send").length, 1);
});
```

Add cases for 401/403 => `auth_error`, 429/500 => `temporary`, endpoint revalidation failure => `invalid_target`, and ordinary exceptions => `error`; none except 404/410 may call `removeEndpoint`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test lib/push-service.test.mjs
```

Expected: FAIL because `PushService` does not exist.

- [ ] **Step 3: Implement parallel delivery through the validated Agent**

`PushService.send()` must:

1. return `{attempted:0,sent:0,results:[]}` for disabled config;
2. throw a safe `PUSH_CONFIG_ERROR` for erroneous config;
3. load persistent VAPID keys and call `client.setVapidDetails(subject, publicKey, privateKey)`;
4. obtain `store.listAuthorized(password)` and, when the exact optional endpoint argument is present, filter to that endpoint;
5. for every record, call `validatePushSubscription({endpoint, keys:{p256dh,auth}})` again to protect against hand-edited state;
6. use `Promise.all` over isolated per-device sends;
7. call `sendNotification(subscription, JSON.stringify(payload), { TTL: 300, timeout: 10_000, agent })` with no `proxy` property;
8. classify `statusCode` exactly as tests require and delete only 404/410;
9. log only endpoint hostname and status, never the endpoint path, keys, password, fingerprint, or private key.

The default client is the imported `web-push` module; the default agent is one singleton from `createPushHttpsAgent()`. Store `getPushService()` on `globalThis.__piPushService` across hot reload.

- [ ] **Step 4: Verify GREEN**

```bash
node --test lib/push-service.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: delivery tests PASS, including agent/no-proxy assertions.

- [ ] **Step 5: Commit the delivery service**

```bash
git add lib/push-service.ts lib/push-service.test.mjs
git commit -m "feat: deliver bounded Web Push notifications"
```

### Task 11: Expose Authenticated Push Status, Subscription, and Test APIs

**Files:**
- Create: `app/api/push/status/route.ts`
- Create: `app/api/push/vapid-public-key/route.ts`
- Create: `app/api/push/subscribe/route.ts`
- Create: `app/api/push/test/route.ts`
- Create: `app/api/push/routes.test.mjs`

**Interfaces:**

```ts
export type PushStatusResponse = {
  supported: boolean;
  gateEnabled: boolean;
  configured: boolean;
  publicKeyAvailable: boolean;
  code?: string;
};
export type VapidPublicKeyResponse = { publicKey: string };
export type SubscribeResponse = { ok: true; status: "created" | "updated" };
export type UnsubscribeResponse = { ok: true; removed: boolean };
export type TestPushResponse = { ok: true; accepted: number };
```

Each route also exports a dependency-injected factory for direct tests, while the App Router export binds production singletons:

```ts
export function createStatusHandler(deps: StatusDeps): (request: Request) => Promise<Response>;
export function createPublicKeyHandler(deps: PublicKeyDeps): (request: Request) => Promise<Response>;
export function createSubscribeHandlers(deps: SubscribeDeps): {
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
};
export function createTestHandler(deps: TestDeps): (request: Request) => Promise<Response>;
```

Only `GET /api/push/status` is callable for diagnostics when the gate is disabled; `vapid-public-key`, subscribe/unsubscribe, presence, and test all require an enabled authenticated gate. All responses use `Cache-Control: no-store`.

- [ ] **Step 1: Write failing direct route tests**

Create `app/api/push/routes.test.mjs` with `jiti` and injected stores/services. Use these helpers:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const statusRoute = await jiti.import("./status/route.ts");
const keyRoute = await jiti.import("./vapid-public-key/route.ts");
const subscribeRoute = await jiti.import("./subscribe/route.ts");
const testRoute = await jiti.import("./test/route.ts");
const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
const pushEnabled = { status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" };
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const auth = Buffer.alloc(16, 2).toString("base64url");
function jsonRequest(path, method, body, headers = {}) {
  return new Request(`https://pi.example${path}`, {
    method,
    headers: { origin: "https://pi.example", "content-type": "application/json", "x-pi-web-auth-status": "enabled", ...headers },
    body: JSON.stringify(body),
  });
}
```

Add these tests:

```js
test("status returns safe no-store capability without exposing keys", async () => {
  const handler = statusRoute.createStatusHandler({
    readGateConfig: () => enabled,
    readPushConfig: () => pushEnabled,
    store: { getPublicKey: async () => "public-key" },
  });
  const response = await handler(new Request("https://pi.example/api/push/status", {
    headers: { "x-pi-web-auth-status": "enabled" },
  }));
  const body = await response.json();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    supported: true, gateEnabled: true, configured: true, publicKeyAvailable: true,
  });
  assert.doesNotMatch(JSON.stringify(body), /private|secret/i);
});

test("public key and subscription mutation require enabled authenticated gate", async () => {
  const getKey = keyRoute.createPublicKeyHandler({
    readGateConfig: () => enabled,
    store: { getPublicKey: async () => "public-key" },
  });
  const unauthorized = await getKey(new Request("https://pi.example/api/push/vapid-public-key"));
  assert.equal(unauthorized.status, 401);
  const authorized = await getKey(new Request("https://pi.example/api/push/vapid-public-key", {
    headers: { "x-pi-web-auth-status": "enabled" },
  }));
  assert.deepEqual(await authorized.json(), { publicKey: "public-key" });
});

test("subscribe validates then creates, updates, and reports the twenty-device limit", async () => {
  const seen = [];
  let result = "created";
  const handlers = subscribeRoute.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: {
      upsert: async (value, password) => { seen.push([value, password]); return result; },
      remove: async () => true,
    },
  });
  const body = { endpoint: "https://push.example/a", keys: { p256dh, auth } };
  let response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "created");
  assert.equal(seen[0][1], "secret");
  result = "updated";
  response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  assert.equal((await response.json()).status, "updated");
  result = "limit";
  response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PUSH_SUBSCRIPTION_LIMIT");
});

test("unsubscribe deletes only the current fingerprint endpoint", async () => {
  const calls = [];
  const handlers = subscribeRoute.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: { upsert: async () => "created", remove: async (...args) => { calls.push(args); return true; } },
  });
  const response = await handlers.DELETE(jsonRequest("/api/push/subscribe", "DELETE", { endpoint: "https://push.example/a" }));
  assert.deepEqual(await response.json(), { ok: true, removed: true });
  assert.deepEqual(calls, [["https://push.example/a", "secret"]]);
});

test("test route sends only its fixed payload to the submitted authorized endpoint", async () => {
  const calls = [];
  const handler = testRoute.createTestHandler({
    readGateConfig: () => enabled,
    service: { send: async (...args) => { calls.push(args); return { attempted: 1, sent: 1, results: [] }; } },
    createId: () => "notification-id",
  });
  const response = await handler(jsonRequest("/api/push/test", "POST", { endpoint: "https://push.example/a" }));
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.deepEqual(calls, [[
    { version: 1, id: "notification-id", kind: "test" }, "secret", "https://push.example/a",
  ]]);
});
```

Also call every mutating handler with wrong Origin, non-JSON Content-Type, malformed JSON, and a body over 16 KiB to prove they share Task 9's exact statuses/codes and `no-store` headers.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test app/api/push/routes.test.mjs
```

Expected: FAIL because Push routes do not exist.

- [ ] **Step 3: Implement status and public-key routes**

`GET /api/push/status` is protected by the proxy in enabled mode but remains a safe diagnostic endpoint when the application gate is explicitly disabled. It does not return a key. It must:

- In enabled mode, `GET /api/push/status` requires `x-pi-web-auth-status: enabled` and returns 401 without it; in explicitly disabled mode it returns only `gateEnabled:false` diagnostic state.
- return `gateEnabled:false`, `configured:false`, `publicKeyAvailable:false`, and safe code `PUSH_GATE_REQUIRED` when gate is disabled;
- read gate and Push config;
- in enabled mode, require the proxy-authenticated header before revealing configured/public-key availability;
- return safe `PUSH_CONFIG_ERROR` or `PUSH_STORE_LOCKED` without log details;
- call `store.getPublicKey()` only for enabled gate + enabled Push config;
- always use `pushJson()`.

`GET /api/push/vapid-public-key` uses `requireEnabledPushRequest`, verifies Push config is enabled, and returns only `{publicKey}` with `no-store`. A disabled/error Push config returns 503 with a safe code.

- [ ] **Step 4: Implement subscribe, unsubscribe, and test handlers**

In `subscribe/route.ts`:

- both methods call `requireEnabledPushRequest` then `readPushJsonBody`;
- POST passes body to `validatePushSubscription`, then `store.upsert(validated, password)`;
- validation errors return `400 PUSH_INVALID_SUBSCRIPTION`;
- limit returns `409 PUSH_SUBSCRIPTION_LIMIT`;
- DELETE accepts a plain object containing only nonempty `endpoint`, enforces HTTPS and <=4096 bytes, then calls `store.remove(endpoint, password)`.

In `test/route.ts`:

- accept exactly `{endpoint:string}` with the same basic endpoint structure/length check;
- create only `{version:1,id:createId(),kind:"test"}`;
- call `service.send(payload, password, endpoint)`;
- if `attempted === 0`, return `404 PUSH_SUBSCRIPTION_NOT_FOUND`;
- if `sent === 0`, return `502 PUSH_TEST_FAILED` with no endpoint or provider details;
- otherwise return `{ok:true,accepted:sent}`.

Production exports bind `readGateConfig`, `readPushConfig`, `getPushStore()`, `getPushService()`, and `randomUUID()` to the factories.

- [ ] **Step 5: Verify GREEN**

```bash
node --test app/api/push/routes.test.mjs lib/push-request.test.mjs lib/push-target.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: route and supporting security tests PASS.

- [ ] **Step 6: Commit the Push APIs**

```bash
git add app/api/push/status/route.ts app/api/push/vapid-public-key/route.ts app/api/push/subscribe/route.ts app/api/push/test/route.ts app/api/push/routes.test.mjs
git commit -m "feat: expose authenticated Push APIs"
```

---

### Task 12: Add Browser Subscription Controls and Service Worker Push Handling

**Files:**
- Create: `hooks/useWebPush.ts`
- Create: `components/PushNotificationControl.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `public/sw.js`
- Create: `hooks/useWebPush.test.mjs`
- Create: `components/PushNotificationControl.test.mjs`
- Modify: `public/sw-policy.test.mjs`

**Interfaces:**

```ts
export type WebPushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  enable(): Promise<void>;
  disable(): Promise<void>;
  sendTest(): Promise<void>;
};
export function urlBase64ToUint8Array(value: string): Uint8Array;
export function serializePushSubscription(subscription: PushSubscription): {
  endpoint: string; keys: { p256dh: string; auth: string };
};
export function useWebPush(): WebPushState;
```

- [ ] **Step 1: Write failing browser helper and UI contract tests**

Create `hooks/useWebPush.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const hook = await jiti.import("./useWebPush.ts");

test("converts unpadded VAPID base64url to exact bytes", () => {
  const input = Buffer.from([1, 2, 3, 250, 251, 252]).toString("base64url");
  assert.deepEqual([...hook.urlBase64ToUint8Array(input)], [1, 2, 3, 250, 251, 252]);
});

test("serializes only endpoint and browser subscription keys", () => {
  const subscription = {
    endpoint: "https://push.example/a",
    getKey(name) { return name === "p256dh" ? Uint8Array.from([1, 2]).buffer : Uint8Array.from([3, 4]).buffer; },
  };
  assert.deepEqual(hook.serializePushSubscription(subscription), {
    endpoint: "https://push.example/a",
    keys: { p256dh: "AQI", auth: "AwQ" },
  });
});
```

Create `components/PushNotificationControl.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const hook = readFileSync(new URL("../hooks/useWebPush.ts", import.meta.url), "utf8");
const control = readFileSync(new URL("./PushNotificationControl.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("notification permission is requested only inside the explicit enable action", () => {
  const enableStart = hook.indexOf("const enable");
  const disableStart = hook.indexOf("const disable", enableStart);
  assert.ok(enableStart >= 0 && disableStart > enableStart);
  assert.match(hook.slice(enableStart, disableStart), /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(hook.slice(0, enableStart), /requestPermission/);
});

test("control exposes enable, disable, and test states and is mounted by AppShell", () => {
  assert.match(control, /Enable completion notifications/);
  assert.match(control, /Disable notifications/);
  assert.match(control, /Send test notification/);
  assert.match(shell, /<PushNotificationControl/);
});
```

Extend `public/sw-policy.test.mjs`:

```js
test("Push rendering accepts only fixed v1 branches and never trusts payload copy or URLs", () => {
  assert.match(source, /addEventListener\("push"/);
  assert.match(source, /kind === "agent"/);
  assert.match(source, /kind === "test"/);
  assert.match(source, /Agent run finished/);
  assert.match(source, /Test notification delivered/);
  assert.doesNotMatch(source, /payload\.(title|body|tag|url)/);
});

test("notification clicks construct local destinations", () => {
  assert.match(source, /encodeURIComponent\(payload\.sessionId\)/);
  assert.match(source, /clients\.matchAll/);
  assert.match(source, /clients\.openWindow/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test hooks/useWebPush.test.mjs components/PushNotificationControl.test.mjs public/sw-policy.test.mjs
```

Expected: FAIL because hook/control and SW Push handlers do not exist.

- [ ] **Step 3: Implement browser subscription reconciliation**

Create `hooks/useWebPush.ts` as a client hook. `supported` requires `window.isSecureContext`, `serviceWorker`, `PushManager`, and `Notification`. On mount:

1. fetch `/api/push/status`; if gate/config unsupported, expose its safe code as UI error without requesting permission;
2. if `Notification.permission !== "granted"`, stop;
3. wait for `navigator.serviceWorker.ready` and call `pushManager.getSubscription()`;
4. if a subscription exists, POST it to `/api/push/subscribe` to rebind the current password fingerprint;
5. if it disappeared, do not create one automatically unless the user had previously enabled notifications, tracked by localStorage key `pi-web:push-enabled`; when that key is `"1"`, fetch the public key, create a replacement, and POST it;
6. never call `Notification.requestPermission()` during this effect.

On mount, also listen for Service Worker messages of exact shape `{type:"PUSH_SUBSCRIPTION_CHANGED"}` and rerun the same granted-permission reconciliation without calling `Notification.requestPermission()`. Remove the listener on cleanup.

Implement actions:

```ts
const enable = useCallback(async () => {
  setBusy(true);
  try {
    const permission = await Notification.requestPermission();
    setPermission(permission);
    if (permission !== "granted") throw new Error("Notification permission was not granted");
    const registration = await navigator.serviceWorker.ready;
    const publicKey = await fetchJson<{ publicKey: string }>("/api/push/vapid-public-key");
    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey.publicKey) });
    await postSubscription(subscription);
    localStorage.setItem("pi-web:push-enabled", "1");
    setSubscribed(true);
  } finally { setBusy(false); }
}, []);
```

`disable()` captures endpoint, calls browser `unsubscribe()` first, then always attempts DELETE `/api/push/subscribe` in `finally`, removes localStorage, and clears subscribed state. `sendTest()` requires the current subscription and POSTs only `{endpoint}` to `/api/push/test`.

All fetch errors expose safe server `error`/`code`; never expose subscription keys.

- [ ] **Step 4: Implement the control and mount it**

Create `PushNotificationControl.tsx` as a compact button/popover using `useWebPush()`:

- unsupported: disabled bell with explanation;
- default: `Enable completion notifications` button calls `enable` directly from click;
- denied: explain browser/system settings are required;
- subscribed: show `Send test notification` and `Disable notifications`;
- iOS non-standalone: show `Add Pi Web to the Home Screen before enabling notifications` and do not call permission.

Mount it next to `AuthControls` in AppShell's fixed bottom-right group without replacing the existing sound toggle in ChatInput.

- [ ] **Step 5: Add strict Push and click handlers to the Service Worker**

Append plain-JS equivalents of Task 5's parser/presentation to `public/sw.js`. Reject extra keys. Add:

```js
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let raw;
    try { raw = event.data?.json(); } catch { return; }
    const payload = parseNotificationPayload(raw);
    if (!payload) return;
    const view = getNotificationPresentation(payload);
    await self.registration.showNotification(view.title, {
      body: view.body,
      tag: view.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: payload,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const payload = parseNotificationPayload(event.notification.data);
    const relative = payload ? getNotificationPresentation(payload).url : "/";
    const target = new URL(relative, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); return; }
    await self.clients.openWindow(target);
  })());
});
```

Do not add payloads to Cache Storage. Add a `pushsubscriptionchange` listener that posts `{type:"PUSH_SUBSCRIPTION_CHANGED"}` to all same-origin window clients returned by `clients.matchAll({type:"window", includeUncontrolled:true})`; Task 12's hook message listener performs best-effort reconciliation. Authenticated application startup remains the recovery authority, so browsers that omit this event still recover.

- [ ] **Step 6: Verify GREEN**

```bash
node --test hooks/useWebPush.test.mjs components/PushNotificationControl.test.mjs public/sw-policy.test.mjs
node --check public/sw.js
node_modules/.bin/tsc --noEmit
npx eslint hooks/useWebPush.ts components/PushNotificationControl.tsx components/AppShell.tsx
```

Expected: tests PASS; no permission request occurs on mount.

- [ ] **Step 7: Commit client Push support**

```bash
git add hooks/useWebPush.ts hooks/useWebPush.test.mjs components/PushNotificationControl.tsx components/PushNotificationControl.test.mjs components/AppShell.tsx public/sw.js public/sw-policy.test.mjs
git commit -m "feat: add browser Push controls"
```

### Task 13: Track Authenticated Visible SSE Clients and Toast ACKs

**Files:**
- Create: `lib/push-presence.ts`
- Create: `lib/push-presence.test.mjs`
- Create: `app/api/push/presence/route.ts`
- Modify: `app/api/agent/running/events/route.ts`
- Create: `app/api/push/presence.test.mjs`
- Create: `app/api/agent/running/events/route.test.mjs`

**Interfaces:**

```ts
export const PRESENCE_STALE_MS = 35_000;
export const NOTIFICATION_ACK_TIMEOUT_MS = 1_500;
export type PresenceVisibility = "visible" | "hidden";
export type PresenceSend = (message: RunningEventsMessage) => void;
export class PresenceRegistry {
  constructor(options?: {
    now?: () => number;
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  });
  register(connectionId: string, authFingerprint: string, send: PresenceSend): void;
  unregister(connectionId: string): void;
  update(input: { connectionId: string; authFingerprint: string; visibility: PresenceVisibility; ackNotificationId?: string }): boolean;
  has(connectionId: string, authFingerprint: string): boolean;
  deliver(notification: AgentNotificationPayloadV1, authFingerprint: string): Promise<boolean>;
  prune(now?: number): void;
}
export function getPresenceRegistry(): PresenceRegistry;
```

The running SSE route additionally exports:

```ts
export type RunningEventsDeps = {
  createConnectionId(): string;
  getAuthFingerprint(): Promise<string | null>;
  registry: Pick<PresenceRegistry, "register" | "unregister">;
  getRunningIds(): string[];
  subscribe(listener: (ids: string[]) => void): () => void;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};
export function createRunningEventsHandler(deps: RunningEventsDeps): (request: Request) => Promise<Response>;
```

- [ ] **Step 1: Write failing PresenceRegistry tests**

Create `lib/push-presence.test.mjs` with a deterministic clock:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { PresenceRegistry } = await jiti.import("./push-presence.ts");
const payload = { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" };

function fixture() {
  let now = 1_000;
  const timers = new Map(); let nextTimer = 1;
  const registry = new PresenceRegistry({
    now: () => now,
    setTimer: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return { registry, advance(ms) { now += ms; }, expire() { for (const fn of [...timers.values()]) fn(); timers.clear(); } };
}

test("visible fresh connection suppresses Push only after matching authenticated ACK", async () => {
  const { registry } = fixture();
  const sent = [];
  registry.register("c1", "fingerprint", (message) => sent.push(message));
  registry.update({ connectionId: "c1", authFingerprint: "fingerprint", visibility: "visible" });
  const delivered = registry.deliver(payload, "fingerprint");
  assert.deepEqual(sent, [{ type: "notification", notification: payload }]);
  assert.equal(registry.update({
    connectionId: "c1", authFingerprint: "wrong", visibility: "visible", ackNotificationId: "n1",
  }), false);
  assert.equal(registry.update({
    connectionId: "c1", authFingerprint: "fingerprint", visibility: "visible", ackNotificationId: "n1",
  }), true);
  assert.equal(await delivered, true);
});

test("hidden, stale, disconnected, send failure, and ACK timeout do not suppress Push", async () => {
  for (const mode of ["hidden", "stale", "disconnected", "send-error", "timeout"]) {
    const { registry, advance, expire } = fixture();
    registry.register("c1", "fp", () => { if (mode === "send-error") throw new Error("closed"); });
    registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: mode === "hidden" ? "hidden" : "visible" });
    if (mode === "stale") advance(35_001);
    if (mode === "disconnected") registry.unregister("c1");
    const result = registry.deliver(payload, "fp");
    expire();
    assert.equal(await result, false, mode);
  }
});

test("late ACK is ignored safely after timeout", async () => {
  const { registry, expire } = fixture();
  registry.register("c1", "fp", () => {});
  registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: "visible" });
  const result = registry.deliver(payload, "fp");
  expire();
  assert.equal(await result, false);
  assert.equal(registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: "visible", ackNotificationId: "n1" }), true);
});
```

- [ ] **Step 2: Run registry tests and verify RED**

```bash
node --test lib/push-presence.test.mjs
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the global registry and ACK waiter lifecycle**

Each record stores `connectionId`, fingerprint, visibility initially `hidden`, `lastSeen`, send function, and `pendingAcks: Map<string, () => void>`.

`has(connectionId, fingerprint)` prunes first and returns true only for an existing matching record. `update()` must:

- prune first;
- reject nonexistent connection or fingerprint mismatch;
- update visibility/lastSeen;
- if `ackNotificationId` matches a pending waiter for that connection, resolve it and remove it;
- return true for an authenticated existing connection even if the ACK is late/unknown.

`deliver(notification, fingerprint)` must:

1. prune;
2. select records with matching fingerprint, `visible`, and `now-lastSeen <= 35_000`;
3. create one shared promise that resolves true on the first matching ACK and false after 1500 ms;
4. register an ACK resolver under `notification.id` on each candidate before calling `send`;
5. remove any candidate whose send throws; if none send successfully, resolve false immediately;
6. on completion clear timer and remove that notification ID from every candidate;
7. a late ACK updates heartbeat but cannot resurrect the completed promise.

Store `getPresenceRegistry()` in `globalThis.__piPushPresenceRegistry`.

- [ ] **Step 4: Write failing presence route and running SSE tests**

Create `app/api/push/presence.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("./presence/route.ts");
const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };

test("presence route scopes visibility and ACK to the current fingerprint", async () => {
  const calls = [];
  const handler = route.createPresenceHandler({
    readGateConfig: () => enabled,
    getFingerprint: async (password) => { assert.equal(password, "secret"); return "fp"; },
    registry: { has: (connectionId, fingerprint) => connectionId === "c1" && fingerprint === "fp", update: (input) => { calls.push(input); return true; } },
  });
  const response = await handler(new Request("https://pi.example/api/push/presence", {
    method: "POST",
    headers: { origin: "https://pi.example", "content-type": "application/json", "x-pi-web-auth-status": "enabled" },
    body: JSON.stringify({ connectionId: "c1", visibility: "visible", ackNotificationId: "n1" }),
  }));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls, [{ connectionId: "c1", visibility: "visible", ackNotificationId: "n1", authFingerprint: "fp" }]);
});
```

Create `app/api/agent/running/events/route.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const route = await jiti.import("./route.ts");

test("running stream sends connected then running and unregisters on abort", async () => {
  const calls = [];
  const controller = new AbortController();
  const handler = route.createRunningEventsHandler({
    createConnectionId: () => "c1",
    getAuthFingerprint: async () => "fp",
    registry: {
      register: (...args) => calls.push(["register", ...args]),
      unregister: (...args) => calls.push(["unregister", ...args]),
    },
    getRunningIds: () => ["s1"],
    subscribe: () => () => calls.push(["unsubscribe"]),
  });
  const response = await handler(new Request("https://pi.example/api/agent/running/events", { signal: controller.signal }));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"type":"running"')) text += decoder.decode((await reader.read()).value);
  assert.ok(text.indexOf('"type":"connected"') < text.indexOf('"type":"running"'));
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some(([name, id]) => name === "unregister" && id === "c1"));
});
```

- [ ] **Step 5: Implement the presence API and running stream registration**

Create `app/api/push/presence/route.ts` factory. `PresenceRouteDeps.registry` is `Pick<PresenceRegistry, "has" | "update">`; this keeps the direct route test and production singleton on the same interface. It must use Task 9 helpers and the same 16 KiB/Origin/JSON boundary as every other mutating Push API; accept exactly:

```ts
{ connectionId: string; visibility: "visible" | "hidden"; ackNotificationId?: string }
```

Limit connection/notification IDs to 128 characters and reject extra keys with `400 PUSH_INVALID_BODY`. Compute fingerprint with:

```ts
const keys = await getPushStore().getVapidKeys();
computeAuthFingerprint(password, keys.privateKey)
```

Call `registry.has(connectionId, fingerprint)` before applying the update; unknown/stale/mismatched connection returns `404 PUSH_CONNECTION_NOT_FOUND`, otherwise call `registry.update(...)` and return `{ok:true}`. A late/unknown ACK on an existing connection remains a successful heartbeat.

Refactor `app/api/agent/running/events/route.ts` into the factory interface above. Production `getAuthFingerprint()` first reads `readPushConfig()` and returns null when Push is disabled/error; it then reads the enabled gate config, gets VAPID keys, and computes the same fingerprint. It also returns null and does not register when gate is not enabled or the Push store is locked. Handler flow:

1. await fingerprint and create random connection ID;
2. create stream encoder;
3. if fingerprint exists, register the encoder-backed send function;
4. emit `{type:"connected",connectionId}`;
5. subscribe before snapshot, then emit `{type:"running",runningSessionIds}`;
6. retain 30-second comment heartbeat;
7. cleanup interval, running subscription, and presence connection exactly once on abort/cancel.

Notification sends occur only through `PresenceRegistry.deliver`; the route itself never invents notification events.

- [ ] **Step 6: Verify GREEN**

```bash
node --test lib/push-presence.test.mjs app/api/push/presence.test.mjs app/api/agent/running/events/route.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: registry, authenticated route, and stream protocol tests PASS.

- [ ] **Step 7: Commit presence and SSE protocol**

```bash
git add lib/push-presence.ts lib/push-presence.test.mjs app/api/push/presence/route.ts app/api/push/presence.test.mjs app/api/agent/running/events/route.ts app/api/agent/running/events/route.test.mjs
git commit -m "feat: track authenticated app presence"
```

---

### Task 14: Lift the Sole Global SSE Owner Into AppShell and ACK Rendered Toasts

**Files:**
- Create: `hooks/useAppPresence.ts`
- Create: `components/AppToast.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `components/SessionSidebar.tsx`
- Create: `hooks/useAppPresence.test.mjs`
- Create: `components/AppShell.presence.test.mjs`

**Interfaces:**

```ts
export type AppToastState = AgentNotificationPayloadV1;
export type AppPresenceState = {
  runningSessionIds: ReadonlySet<string>;
  runningAuthoritative: boolean;
  toast: AppToastState | null;
  acknowledgeToast(id: string): Promise<void>;
  dismissToast(id: string): void;
};
export function parseRunningEventsMessage(value: unknown): RunningEventsMessage | null;
export function useAppPresence(): AppPresenceState;

export type AppToastProps = {
  toast: AppToastState | null;
  onShown(id: string): void;
  onDismiss(id: string): void;
  onOpenSession(sessionId: string): void;
};
```

`SessionSidebar` adds:

```ts
liveRunningSessionIds: ReadonlySet<string>;
runningAuthoritative: boolean;
```

and retains its `/api/sessions` running snapshot only as fallback until the first live running frame.

- [ ] **Step 1: Write failing parser and ownership tests**

Create `hooks/useAppPresence.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const hook = await jiti.import("./useAppPresence.ts");

test("parses only connected, running, and validated agent notification frames", () => {
  assert.deepEqual(hook.parseRunningEventsMessage({ type: "connected", connectionId: "c1" }), { type: "connected", connectionId: "c1" });
  assert.deepEqual(hook.parseRunningEventsMessage({ type: "running", runningSessionIds: ["s1"] }), { type: "running", runningSessionIds: ["s1"] });
  assert.deepEqual(hook.parseRunningEventsMessage({
    type: "notification", notification: { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" },
  }), {
    type: "notification", notification: { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" },
  });
  assert.equal(hook.parseRunningEventsMessage({ type: "notification", notification: { version: 1, id: "n", kind: "test" } }), null);
  assert.equal(hook.parseRunningEventsMessage({ type: "running", runningSessionIds: [1] }), null);
});
```

Create `components/AppShell.presence.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useAppPresence.ts", import.meta.url), "utf8");
const perSession = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");

test("only AppShell's presence hook owns the global running EventSource", () => {
  assert.match(shell, /useAppPresence\(\)/);
  assert.match(hook, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.doesNotMatch(sidebar, /new EventSource|\/api\/agent\/running\/events/);
});

test("per-session SSE remains unchanged", () => {
  assert.match(perSession, /new EventSource\(`\/api\/agent\/\$\{sid\}\/events`\)/);
});

test("AppShell passes live running state and mounts the app-level toast", () => {
  assert.match(shell, /liveRunningSessionIds=\{presence\.runningSessionIds\}/);
  assert.match(shell, /runningAuthoritative=\{presence\.runningAuthoritative\}/);
  assert.match(shell, /<AppToast/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test hooks/useAppPresence.test.mjs components/AppShell.presence.test.mjs
```

Expected: FAIL because parser/hook/toast and lifted ownership do not exist.

- [ ] **Step 3: Implement the single EventSource/presence hook**

Create `hooks/useAppPresence.ts` as a client hook. Pure parser rules:

- connected: nonempty string ID <=128;
- running: array of strings;
- notification: call `parseNotificationPayload`, then require `kind === "agent"`.

Hook behavior:

```ts
const HEARTBEAT_MS = 15_000;
const [connectionId, setConnectionId] = useState<string | null>(null);
const [runningSessionIds, setRunningSessionIds] = useState<ReadonlySet<string>>(new Set());
const [runningAuthoritative, setRunningAuthoritative] = useState(false);
const [toast, setToast] = useState<AppToastState | null>(null);
const connectionIdRef = useRef<string | null>(null);
```

Mount exactly one `EventSource("/api/agent/running/events")`. On connected, replace the ID (auto-reconnect may create a new server connection); on running, set the set and authoritative true; on validated notification, set toast but do not ACK yet. Close on unmount.

Define a shared POST helper:

```ts
const reportPresence = async (ackNotificationId?: string) => {
  const id = connectionIdRef.current;
  if (!id) return;
  await fetch("/api/push/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId: id,
      visibility: document.visibilityState === "visible" ? "visible" : "hidden",
      ...(ackNotificationId ? { ackNotificationId } : {}),
    }),
  });
};
```

Immediately report after receiving a connection ID, on every `visibilitychange`, and every 15 seconds only while visible. `acknowledgeToast(id)` calls `reportPresence(id)` only when `toast?.id === id`; failures leave the server to time out and Push. `dismissToast` clears only matching toast.

- [ ] **Step 4: Implement AppToast ACK-after-mount**

`AppToast.tsx` validates presentation through `getNotificationPresentation(toast)` and calls `onShown(toast.id)` inside a `useEffect([toast?.id])`, not in the EventSource callback. Render fixed title/body with Open and Dismiss buttons. Open calls `onOpenSession(sessionId)`; because only agent toasts reach the component, sessionId is always present.

- [ ] **Step 5: Lift running state while preserving initial sessions fallback**

In `SessionSidebar.tsx`:

- add `liveRunningSessionIds` and `runningAuthoritative` props;
- rename local state to `fallbackRunningSessionIds`;
- in `loadSessions`, always refresh `fallbackRunningSessionIds` from `data.runningSessionIds ?? []`; after `runningAuthoritative` becomes true this state is retained only as a dormant reconnect fallback and cannot overwrite the effective live set;
- define:

```ts
const runningSessionIds = runningAuthoritative
  ? new Set(liveRunningSessionIds)
  : fallbackRunningSessionIds;
```

- remove `sseAuthoritativeRef` and the entire EventSource effect;
- retain unread/completed derivation based on the effective `runningSessionIds`.

In `AppShell.tsx`, call `const presence = useAppPresence()` once. Pass its running values to the sidebar and update `PwaUpdateBanner` to receive the real set. Mount `AppToast` at shell level. Implement its Open callback by fetching `/api/sessions`, locating the matching `SessionInfo`, and calling existing `handleSelectSession`. If the session is not yet in the response, perform a full same-origin navigation so the existing initial `?session=` restore path runs:

```ts
const relative = `/?session=${encodeURIComponent(sessionId)}`;
const full = sessions.find((item) => item.id === sessionId);
if (full) handleSelectSession(full);
else window.location.assign(relative);
```

- [ ] **Step 6: Verify GREEN and existing sidebar contracts**

```bash
node --test hooks/useAppPresence.test.mjs components/AppShell.presence.test.mjs components/SessionSidebar.project-click.test.mjs components/AppShell.auth.test.mjs components/AppShell.workspace.test.mjs
node_modules/.bin/tsc --noEmit
npx eslint hooks/useAppPresence.ts components/AppToast.tsx components/AppShell.tsx components/SessionSidebar.tsx
```

Expected: one global EventSource, unchanged per-session SSE, preserved sidebar behavior, and clean types/lint.

- [ ] **Step 7: Commit the single-owner foreground path**

```bash
git add hooks/useAppPresence.ts hooks/useAppPresence.test.mjs components/AppToast.tsx components/AppShell.tsx components/SessionSidebar.tsx components/AppShell.presence.test.mjs
git commit -m "feat: route foreground notifications through AppShell"
```

---

### Task 15: Notify Once After the Server-Owned Agent Cycle Settles

**Files:**
- Create: `lib/settled-cycle.ts`
- Create: `lib/settled-cycle.test.mjs`
- Create: `lib/push-notifier.ts`
- Create: `lib/push-notifier.test.mjs`
- Modify: `hooks/useAgentSession.ts`
- Modify: `lib/rpc-manager.ts`
- Modify: `lib/pi-types.ts`
- Create: `lib/rpc-manager.settled.test.mjs`
- Create: `hooks/useAgentSession.retry-settled.test.mjs`

**Interfaces:**

```ts
export type SettledCandidate = { messages: unknown[]; willRetry?: boolean };
export type SettledCycleSnapshot = { sessionId: string; cycleId: number; messages: unknown[] };
export class SettledCycleTracker {
  constructor(sessionId: string);
  accept(event: { type: string; [key: string]: unknown }): SettledCycleSnapshot | null;
}
export type SettledNotificationResult = "success" | "error";
export function classifySettledMessages(messages: unknown[]): SettledNotificationResult | null;
export class PushNotifier {
  constructor(options?: PushNotifierOptions);
  handleSettled(snapshot: SettledCycleSnapshot): Promise<void>;
}
export function getPushNotifier(): PushNotifier;
```

`AgentSessionWrapper` constructor becomes:

```ts
constructor(
  public readonly inner: AgentSessionLike,
  options: { settledNotifier?: (snapshot: SettledCycleSnapshot) => void | Promise<void> } = {},
)
```

Existing call sites remain valid.

- [ ] **Step 1: Write failing pure settled-cycle tests**

Create `lib/settled-cycle.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { SettledCycleTracker } = await jiti.import("./settled-cycle.ts");

test("allocates on first start, overwrites candidates, and consumes exactly once at settled", () => {
  const tracker = new SettledCycleTracker("s1");
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
  assert.equal(tracker.accept({ type: "agent_start" }), null);
  assert.equal(tracker.accept({ type: "agent_start" }), null);
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }], willRetry: true });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  assert.deepEqual(tracker.accept({ type: "agent_settled" }), {
    sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }],
  });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});

test("the next independent start receives a new cycle id", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  tracker.accept({ type: "agent_settled" });
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
  assert.equal(tracker.accept({ type: "agent_settled" }).cycleId, 2);
});

test("settled without a candidate and command errors without agent_start do not notify", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "prompt_error", errorMessage: "bad" });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
  tracker.accept({ type: "agent_start" });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});
```

- [ ] **Step 2: Run cycle tests and verify RED**

```bash
node --test lib/settled-cycle.test.mjs
```

Expected: FAIL because the tracker does not exist.

- [ ] **Step 3: Implement the pure tracker**

`SettledCycleTracker` stores `nextCycleId = 1` and `active: {cycleId,candidate} | null`.

- `agent_start`: create active only when null; repeated starts retain the cycle.
- `agent_end`: when active and `messages` is an array, replace candidate with a shallow copy. Record optional `willRetry` only for diagnostics; never return a snapshot here.
- `agent_settled`: atomically save active, set active null first, then return a snapshot only when candidate exists.
- all other events: no change.

- [ ] **Step 4: Write failing notifier tests**

Create `lib/push-notifier.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const mod = await jiti.import("./push-notifier.ts");

test("classifies the final assistant and ignores aborted or missing assistants", () => {
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "stop" }]), "success");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "length" }]), "success");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "error" }]), "error");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "aborted" }]), null);
  assert.equal(mod.classifySettledMessages([{ role: "user", content: "x" }]), null);
  assert.equal(mod.classifySettledMessages([
    { role: "assistant", stopReason: "error" }, { role: "assistant", stopReason: "stop" },
  ]), "success");
});

test("authenticated foreground ACK suppresses Push", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
    getFingerprint: async () => "fp",
    presence: { deliver: async (...args) => { calls.push(["toast", ...args]); return true; } },
    service: { send: async (...args) => calls.push(["push", ...args]) },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] });
  assert.equal(calls.filter(([kind]) => kind === "toast").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "push").length, 0);
});

test("hidden or unacked foreground falls back to Push without throwing into Agent flow", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
    getFingerprint: async () => "fp",
    presence: { deliver: async () => false },
    service: { send: async (...args) => { calls.push(args); throw new Error("provider down"); } },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "error" }] });
  assert.deepEqual(calls[0][0], { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "error" });
  assert.equal(calls[0][1], "secret");
});
```

Add cases proving disabled/unconfigured/error gate, aborted result, and no assistant produce neither toast nor Push.

- [ ] **Step 5: Implement notification routing**

`classifySettledMessages()` scans backward for the last plain object whose `role === "assistant"`. Return null if none, `error` for exact error, null for aborted, and success for every other terminal stop reason.

`PushNotifier.handleSettled()` wraps its entire body in `try/catch` and logs only session ID/cycle ID plus safe error text. It must:

1. classify; return on null;
2. require current `readGateConfig().status === "enabled"`;
3. load `readPushConfig()` and return without notification when Push is disabled; log its server-only error and return when erroneous;
4. obtain current fingerprint through a helper that loads VAPID keys and calls `computeAuthFingerprint(password, privateKey)`;
5. construct exactly `{version:1,id:createId(),kind:"agent",sessionId,result}`;
6. `await presence.deliver(payload, fingerprint)`;
7. return if ACKed, otherwise `await service.send(payload, password)`;
8. never reject to the Agent event callback.

Store the production notifier on `globalThis.__piPushNotifier`.

- [ ] **Step 6: Write a Push-config-disabled notifier regression test**

Add to `lib/push-notifier.test.mjs` a notifier whose gate is enabled but `readPushConfig()` returns `{status:"disabled", configPath:"/tmp/pi-web.json"}`. Assert that neither `presence.deliver` nor `service.send` is called. Update every existing notifier fixture to inject:

```js
readPushConfig: () => ({
  status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com",
}),
```

Run:

```bash
node --test lib/push-notifier.test.mjs
```

Expected: FAIL until `PushNotifier.handleSettled()` enforces Push config before fingerprint/store access, then PASS after adding the behavior described above.

- [ ] **Step 7: Write failing rpc-manager integration test**

Create `lib/rpc-manager.settled.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const NOOP = () => {};
function fakeSession() {
  let listener;
  return {
    sessionId: "s1", sessionFile: "/tmp/s1.jsonl", isStreaming: false, isCompacting: false,
    autoCompactionEnabled: true, autoRetryEnabled: true, model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: {}, settingsManager: {}, agent: { state: {} },
    extensionRunner: {}, promptTemplates: [], resourceLoader: { getSkills: () => ({ skills: [] }) },
    pendingMessageCount: 0,
    subscribe(fn) { listener = fn; return () => {}; },
    emit(event) { listener(event); },
    getAllTools: () => [], getActiveToolNames: () => [], getSteeringMessages: () => [], getFollowUpMessages: () => [],
    getContextUsage: () => undefined,
  };
}

test("wrapper forwards events while notifying only once after settled", async () => {
  const inner = fakeSession();
  const snapshots = [];
  const forwarded = [];
  const wrapper = new AgentSessionWrapper(inner, { settledNotifier: async (snapshot) => snapshots.push(snapshot) });
  wrapper.onEvent((event) => forwarded.push(event.type));
  wrapper.start();
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }], willRetry: true });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  inner.emit({ type: "agent_settled" });
  inner.emit({ type: "agent_settled" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, [{ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] }]);
  assert.deepEqual(forwarded, ["agent_start", "agent_end", "agent_end", "agent_settled", "agent_settled"]);
  wrapper.destroy();
});
```

Add a test where `settledNotifier` rejects and prove a following event is still forwarded and wrapper remains alive.

- [ ] **Step 8: Run integration test and verify RED**

```bash
node --test lib/rpc-manager.settled.test.mjs
```

Expected: FAIL because the wrapper does not accept a notifier or track cycles.

- [ ] **Step 9: Keep the foreground streaming UI active through automatic retries**

Create `hooks/useAgentSession.retry-settled.test.mjs` as a source-contract regression test:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const start = source.indexOf('case "agent_end"');
const end = source.indexOf('case "prompt_done"', start);
const block = source.slice(start, end);

test("retrying agent_end does not finish foreground streaming state", () => {
  assert.match(block, /event\.willRetry/);
  const guard = block.indexOf("event.willRetry");
  const finish = block.indexOf("setAgentRunning(false)");
  assert.ok(guard >= 0 && guard < finish);
});
```

Run:

```bash
node --test hooks/useAgentSession.retry-settled.test.mjs
```

Expected: FAIL because the current handler ends the UI on every `agent_end`.

Then modify the `agent_end` case in `hooks/useAgentSession.ts` so it still reloads final messages/context as appropriate but, when `event.willRetry === true`, it keeps `agentRunningRef`, `agentRunning`, stream state, and completion sound callback active and exits the case before `setAgentRunning(false)`, `dispatch({type:"end"})`, and `onAgentEnd()`. `auto_retry_start/end` continue to update retry UI. The final nonretrying `agent_end`, `prompt_done`, and existing server reconciliation retain their current completion behavior; this client change affects UI only and does not become the Push trigger.

- [ ] **Step 10: Integrate the tracker without changing SSE semantics**

In `lib/pi-types.ts`, add this local intersection type:

```ts
export type PiWebAgentEvent = Omit<AgentSessionEvent, "willRetry"> & { willRetry?: boolean; messages?: unknown[] };
```

In `AgentSessionWrapper`:

- create `private readonly settledCycles: SettledCycleTracker` and initialize it in the constructor with `this.inner.sessionId`;
- choose `options.settledNotifier ?? ((snapshot) => getPushNotifier().handleSettled(snapshot))`;
- inside the existing subscription callback, call `const settled = this.settledCycles.accept(event)` before `this.emit(event)`;
- preserve existing `agent_end` session-list invalidation;
- preserve `this.emit(event)` and `notifyRunningChange()` for every event;
- when a snapshot exists, schedule after current synchronous handling:

```ts
queueMicrotask(() => {
  void Promise.resolve(this.settledNotifier(settled)).catch((error) => {
    console.error(`[pi-web] settled notification failed for ${settled.sessionId} cycle ${settled.cycleId}:`, error instanceof Error ? error.message : String(error));
  });
});
```

Even though production notifier catches internally, the wrapper catch protects injected/custom notifiers. Do not add any Push logic to browser `useAgentSession` or trigger from `prompt_done`/`agent_end`.

- [ ] **Step 11: Verify GREEN across lifecycle tests**

```bash
node --test lib/settled-cycle.test.mjs lib/push-notifier.test.mjs lib/rpc-manager.settled.test.mjs lib/rpc-manager.test.mjs hooks/useAgentSession.retry-settled.test.mjs
node_modules/.bin/tsc --noEmit
npx eslint lib/settled-cycle.ts lib/push-notifier.ts lib/rpc-manager.ts lib/pi-types.ts hooks/useAgentSession.ts
```

Expected: all tests PASS; automatic retry candidates produce only the final settled notification.

- [ ] **Step 12: Commit settled notification orchestration**

```bash
git add lib/settled-cycle.ts lib/settled-cycle.test.mjs lib/push-notifier.ts lib/push-notifier.test.mjs lib/rpc-manager.ts lib/pi-types.ts lib/rpc-manager.settled.test.mjs hooks/useAgentSession.ts hooks/useAgentSession.retry-settled.test.mjs
git commit -m "feat: notify when Agent runs settle"
```

---

### Task 16: Document, Package, and Verify the Complete Feature

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `AGENTS.md`
- Create: `docs/pwa-web-push-acceptance.md`
- Create: `public/pwa-package.test.mjs`

**Interfaces:**
- Documentation is the operational interface: configuration, HTTPS/browser requirements, security model, recovery, diagnostics, and a repeatable platform acceptance matrix.
- No production behavior is added in this task.

- [ ] **Step 1: Write failing packaging/documentation tests**

Create `public/pwa-package.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const requiredDocs = ["README.md", "README.zh-CN.md", "AGENTS.md", "docs/pwa-web-push-acceptance.md"];

test("documentation names Push configuration and browser constraints", () => {
  const combined = requiredDocs.map((path) => readFileSync(path, "utf8")).join("\n");
  for (const text of [
    "PI_WEB_PUSH_DISABLED", "PI_WEB_PUSH_SUBJECT", "pi-web-push.json",
    "HTTPS", "localhost", "iOS 16.4", "agent_settled", "Service Worker",
  ]) assert.match(combined, new RegExp(text.replace(".", "\\."), "i"), text);
});

test("npm package includes every public PWA artifact", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const files = new Set(JSON.parse(result.stdout)[0].files.map(({ path }) => path));
  for (const path of [
    "app/manifest.ts", "public/sw.js", "public/offline.html", "public/icons/icon-192.png",
    "public/icons/icon-512.png", "public/icons/maskable-512.png",
    "public/icons/apple-touch-icon.png", "public/icons/badge-96.png",
  ]) assert.equal(files.has(path), true, path);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test public/pwa-package.test.mjs
```

Expected: FAIL because the acceptance document and required README/AGENTS content are absent. Packaging may already pass independently.

- [ ] **Step 3: Document configuration and operational boundaries**

Update both READMEs with matching English/Chinese sections covering:

```json
{
  "auth": { "password": "replace-me", "disabled": false },
  "push": { "disabled": false, "subject": "mailto:owner@example.com" }
}
```

Document:

- env overrides and precedence;
- Push requires enabled password gate, HTTPS except localhost, user gesture, and PWA installation for iOS/iPadOS 16.4+;
- browser closure does not stop an accepted Agent while the pi-web process/host/network remain available;
- foreground HTTP/SSE remains unchanged and Web Push begins only after `agent_settled`;
- visible ACK selects toast; otherwise Push; notifications contain generic text only;
- no offline session cache and no Background Sync;
- state file location, `0600`, backup implications, corruption lock behavior, and password-change rebind flow;
- reverse proxy requirements: do not buffer SSE, preserve long-lived connections, forward HTTPS origin correctly;
- permission recovery and stale subscription cleanup;
- update banner behavior and why automatic reload is disabled.

Update `AGENTS.md` file map and traps with all new modules/routes, secret file hard-deny, one global running SSE owner, ACK timing constants, payload union, socket lookup policy, and no-`next build` rule.

- [ ] **Step 4: Add the manual browser/device acceptance matrix**

Create `docs/pwa-web-push-acceptance.md` with checkboxes and exact expected result for:

1. Desktop Chrome/Edge HTTPS: install, standalone launch, explicit opt-in, fixed test Push, notification click, update banner.
2. Android Chromium HTTPS: install, close app, run Agent, receive settled Push, click into session.
3. iOS/iPadOS 16.4+: add to Home Screen first, enable in standalone, close PWA, receive/click Push.
4. Foreground visible: settled toast appears and no system Push arrives after ACK.
5. Visible but ACK endpoint blocked: system Push appears after approximately 1.5 seconds; possible duplicate on late ACK is accepted.
6. Hidden/frozen/closed: Push arrives; Agent continues server-side.
7. Auto retry/compaction/queued continuation: no intermediate notification; exactly one at final settled.
8. Abort: no completion Push.
9. Offline navigation: generic fallback only; Cache Storage inspection shows no API, HTML, Next chunk, session, code, or tool data.
10. Multi-tab SW update: only confirming tab reloads; other tab shows activated-version prompt.
11. Password change: old subscription receives nothing; login with new password auto-rebinds existing browser subscription without another permission prompt.
12. File Explorer with cwd at home/agent dir: Push state and temp files are absent; direct encoded read returns 403.

Include places to record browser/OS/version, reverse proxy, test date, and evidence screenshots/log-safe endpoint hostname only.

- [ ] **Step 5: Verify documentation and package GREEN**

```bash
node --test public/pwa-package.test.mjs
npm pack --dry-run
```

Expected: documentation and package tests PASS; the dry run lists all required public artifacts.

- [ ] **Step 6: Run the complete automated verification suite**

Run exactly:

```bash
node --test $(find . \
  -path './node_modules' -prune -o \
  -path './.next' -prune -o \
  -path './.git' -prune -o \
  -name '*.test.mjs' -print)
node_modules/.bin/tsc --noEmit
node --check public/sw.js
npx eslint \
  app/layout.tsx app/manifest.ts next.config.ts proxy.ts \
  app/api/files/'[...path]'/route.ts \
  app/api/agent/running/events/route.ts app/api/push/*/route.ts \
  components/AppShell.tsx components/SessionSidebar.tsx components/AppToast.tsx \
  components/OfflineBanner.tsx components/PwaInstallPrompt.tsx components/PwaSettingsControl.tsx components/PwaUpdateBanner.tsx \
  components/PushNotificationControl.tsx \
  hooks/useOnlineStatus.ts hooks/usePwaInstall.ts hooks/usePwaUpdate.ts hooks/useWebPush.ts hooks/useAppPresence.ts \
  lib/pwa-lifecycle.ts lib/push-*.ts lib/settled-cycle.ts lib/file-access.ts lib/web-auth-request.ts lib/rpc-manager.ts lib/pi-types.ts hooks/useAgentSession.ts
npm pack --dry-run
```

Expected:

- every `*.test.mjs` test PASS with no skipped new security tests;
- TypeScript exits 0;
- Service Worker syntax check exits 0;
- changed-file ESLint exits 0;
- package dry run contains Service Worker, offline file, manifest implementation, and all icons;
- no `next build` command was run.

If any command fails, do not mark this task complete; fix it by adding a failing regression test first, then rerun the complete sequence.

- [ ] **Step 7: Perform independent adversarial verification**

Launch a `verification` agent with the original Scheme B request, approved spec, this implementation plan, changed-file list, and verification output. Require it to inspect at least:

- Service Worker cache/request boundaries;
- offline fallback after an intentionally failed noncritical precache request;
- public gate matcher lookalikes;
- Push secret file denial order;
- same-origin/body-size enforcement;
- actual-socket DNS lookup and no-proxy assertion;
- subscription password epoch behavior;
- one global EventSource and unchanged per-session SSE;
- ACK timeout fallback;
- `agent_settled` cycle deduplication and error/abort classification;
- package contents.

Expected: verifier returns APPROVE. For each valid finding, add a failing regression test, implement the minimal correction, and rerun Step 6 plus the verifier.

- [ ] **Step 8: Commit documentation and final verification assets**

```bash
git add README.md README.zh-CN.md AGENTS.md docs/pwa-web-push-acceptance.md public/pwa-package.test.mjs
git commit -m "docs: explain PWA and Web Push operation"
```

- [ ] **Step 9: Confirm final repository state**

```bash
git status --short
git log --oneline -16
```

Expected: no uncommitted implementation files; the recent history shows the incremental commits from this plan. Do not squash before review because each task is an independent verification checkpoint.
