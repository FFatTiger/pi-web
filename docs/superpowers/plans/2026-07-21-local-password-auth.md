# Local Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-password application gate that protects all Pi Agent Web pages and business APIs, reads local configuration from the Pi agent directory, supports an explicit bypass, and provides login/logout UI.

**Architecture:** A server-only config module resolves `$PI_CODING_AGENT_DIR/pi-web.json` through pi's existing `getAgentDir()`, then merges strict environment overrides into one of four public states. A session module signs a 30-day HttpOnly cookie with HMAC-SHA256 derived from the current password, while a small request-policy module lets `proxy.ts`, routes, and tests share redirect/401/503 decisions. Login/logout/status routes expose only safe data; `LoginForm` and a focused `AuthControls` component handle the browser experience without expanding the already-large `AppShell` further.

**Tech Stack:** Next.js 16.2 App Router and `proxy.ts`, React 19, TypeScript, Node `crypto`/`fs`, pi SDK `getAgentDir()`, Node `node:test` with `jiti`, existing CSS variables and inline styles.

## Global Constraints

- Keep existing `app/api/auth/*` routes for model-provider OAuth/API keys; application authentication uses `/api/gate/*`.
- Default to locked when the password is missing, the config file is malformed, a field has the wrong type, or `PI_WEB_AUTH_DISABLED` is invalid.
- The only bypass is explicit `auth.disabled: true` or `PI_WEB_AUTH_DISABLED=true`.
- Configuration priority is environment variable > `pi-web.json` > secure default.
- Default config path is `~/.pi/agent/pi-web.json`; when `PI_CODING_AGENT_DIR` is set, use `$PI_CODING_AGENT_DIR/pi-web.json` through `getAgentDir()`.
- Never send the password, password digest, session signing key, or detailed config-read error to the browser.
- The login cookie lasts 30 days, is `HttpOnly`, `SameSite=Lax`, `Path=/`, and is `Secure` on HTTPS requests.
- Changing the configured password must invalidate every old cookie without a database or server-side session store.
- Safe redirects accept only same-origin paths beginning with one `/`; reject `//`, absolute URLs, control characters, and `/login` loops.
- Protect pages, SSE, files, sessions, models, provider-auth routes, skills, plugins, and worktrees; only `/login`, `/api/gate/status`, `/api/gate/login`, `/api/gate/logout`, and required static assets are public.
- Do not add username, multi-user storage, password reset, CAPTCHA, third-party login, or web-based password editing.
- Do not add a third-party authentication dependency.
- Do not run `next build` during development; validate with targeted tests, `node_modules/.bin/tsc --noEmit`, and `npm run lint`.

## File Structure

### Create

- `lib/web-auth-types.ts` — shared public status and login response types safe for both server and client imports.
- `lib/web-auth-config.ts` — resolve `pi-web.json`, parse strict config, merge env overrides, return locked/enabled/disabled/error state.
- `lib/web-auth-session.ts` — constant-time password comparison, 30-day signed cookie creation/verification, cookie option helpers.
- `lib/web-auth-request.ts` — public-path matching, API detection, safe `next` normalization, and framework-neutral request decisions.
- `lib/web-auth-rate-limit.ts` — bounded in-process failed-login backoff keyed by client address.
- `lib/web-auth-config.test.mjs` — config path, precedence, strict validation, and locked-default tests.
- `lib/web-auth-session.test.mjs` — password, cookie, expiry, tampering, and password-change tests.
- `lib/web-auth-request.test.mjs` — public paths, redirect safety, and page/API decision tests.
- `lib/web-auth-rate-limit.test.mjs` — backoff, reset, cap, and expiry tests.
- `app/api/gate/status/route.ts` — return only public authentication status.
- `app/api/gate/login/route.ts` — validate credentials, apply backoff, set cookie, return sanitized `next`.
- `app/api/gate/logout/route.ts` — expire the session cookie.
- `app/api/gate/routes.test.mjs` — invoke route handlers through `jiti` and verify status/body/cookie contracts.
- `proxy.ts` — Next.js 16 request boundary that applies request-policy decisions.
- `lib/web-auth-proxy.test.mjs` — invoke `proxy()` with `NextRequest` and verify redirects, API responses, cookies, and matcher exclusions.
- `components/LoginForm.tsx` — client login/config-help experience.
- `app/login/page.tsx` — centered login page with Suspense boundary.
- `components/AuthControls.tsx` — authenticated logout button or bypass warning for the top bar.
- `components/LoginForm.test.mjs` — source-contract tests for status/login API use and safe UI branches.
- `components/AuthControls.test.mjs` — source-contract tests for logout and bypass warning behavior.
- `components/AppShell.auth.test.mjs` — source-contract test proving `AuthControls` is mounted independently of session stats.

### Modify

- `components/AppShell.tsx` — mount `AuthControls` in the top bar and keep right-side spacing stable.
- `README.md` — English configuration, bypass, restart, HTTPS, and permission instructions.
- `README.zh-CN.md` — matching Chinese instructions.
- `AGENTS.md` — add auth routes/modules and project traps for future agents.

---

### Task 1: Parse Local Authentication Configuration

**Files:**
- Create: `lib/web-auth-types.ts`
- Create: `lib/web-auth-config.ts`
- Test: `lib/web-auth-config.test.mjs`

**Interfaces:**
- Consumes: `getAgentDir(): string` from `@earendil-works/pi-coding-agent`; injected `env`, `readFile`, and `configPath` in tests.
- Produces:

```ts
export type GateStatusKind = "enabled" | "disabled" | "unconfigured" | "error";

export type GatePublicStatus = {
  status: GateStatusKind;
  configPath: string;
};

export type GateConfig =
  | { status: "enabled"; configPath: string; password: string }
  | { status: "disabled"; configPath: string }
  | { status: "unconfigured"; configPath: string }
  | { status: "error"; configPath: string; logMessage: string };

export type GateStatusResponse = GatePublicStatus;

export type LoginSuccessResponse = { ok: true; next: string };
export type LoginFailureResponse = {
  ok: false;
  error: string;
  status?: Exclude<GateStatusKind, "enabled">;
  retryAfterSeconds?: number;
};

export type ReadGateConfigOptions = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
};

export function getWebAuthConfigPath(): string;
export function readGateConfig(options?: ReadGateConfigOptions): GateConfig;
export function toPublicGateStatus(config: GateConfig): GatePublicStatus;
```

- [ ] **Step 1: Write failing config tests**

Create `lib/web-auth-config.test.mjs` with `node:test`, `assert`, and `jiti`. Keep each test independent by injecting `configPath`, `readFile`, and `env` instead of mutating the real home directory.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readGateConfig, toPublicGateStatus } = await jiti.import("./web-auth-config.ts");

const missingFile = () => {
  const error = new Error("missing");
  error.code = "ENOENT";
  throw error;
};

const readJson = (value) => () => JSON.stringify(value);

test("locks when pi-web.json does not exist", () => {
  assert.deepEqual(
    readGateConfig({ configPath: "/tmp/pi-web.json", readFile: missingFile, env: {} }),
    { status: "unconfigured", configPath: "/tmp/pi-web.json" },
  );
});

test("enables password authentication from the config file", () => {
  assert.deepEqual(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { password: "local-secret", disabled: false } }),
      env: {},
    }),
    { status: "enabled", configPath: "/tmp/pi-web.json", password: "local-secret" },
  );
});

test("explicit disabled true bypasses authentication", () => {
  assert.deepEqual(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { disabled: true } }),
      env: {},
    }),
    { status: "disabled", configPath: "/tmp/pi-web.json" },
  );
});

test("environment variables override only their own config fields", () => {
  const result = readGateConfig({
    configPath: "/tmp/pi-web.json",
    readFile: readJson({ auth: { password: "file-secret", disabled: true } }),
    env: { PI_WEB_PASSWORD: "env-secret", PI_WEB_AUTH_DISABLED: "false" },
  });
  assert.deepEqual(result, {
    status: "enabled",
    configPath: "/tmp/pi-web.json",
    password: "env-secret",
  });
});

test("wrong field types and invalid disabled env values remain locked", () => {
  for (const options of [
    { readFile: readJson({ auth: { password: 123 } }), env: {} },
    { readFile: readJson({ auth: { disabled: "true" } }), env: {} },
    { readFile: readJson({ auth: { password: "secret" } }), env: { PI_WEB_AUTH_DISABLED: "1" } },
  ]) {
    const result = readGateConfig({ configPath: "/tmp/pi-web.json", ...options });
    assert.equal(result.status, "error");
    assert.equal(result.configPath, "/tmp/pi-web.json");
  }
});

test("blank passwords are unconfigured rather than enabled", () => {
  assert.equal(
    readGateConfig({
      configPath: "/tmp/pi-web.json",
      readFile: readJson({ auth: { password: "   " } }),
      env: {},
    }).status,
    "unconfigured",
  );
});

test("public status strips passwords and internal log details", () => {
  assert.deepEqual(
    toPublicGateStatus({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    { status: "enabled", configPath: "/tmp/pi-web.json" },
  );
  assert.deepEqual(
    toPublicGateStatus({ status: "error", configPath: "/tmp/pi-web.json", logMessage: "EACCES details" }),
    { status: "error", configPath: "/tmp/pi-web.json" },
  );
});
```

Also add a direct `getWebAuthConfigPath()` test by temporarily setting `PI_CODING_AGENT_DIR` to a temp path, restoring it in `finally`, and asserting the result ends in `<temp>/pi-web.json`. This verifies use of pi's existing directory resolver rather than duplicating tilde logic.

- [ ] **Step 2: Run the config tests and verify failure**

Run:

```bash
node --test lib/web-auth-config.test.mjs
```

Expected: FAIL because `lib/web-auth-config.ts` and `lib/web-auth-types.ts` do not exist.

- [ ] **Step 3: Implement strict config parsing**

Create `lib/web-auth-types.ts` with the interfaces above. Create `lib/web-auth-config.ts` with this control flow:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { GateConfig, GatePublicStatus, ReadGateConfigOptions } from "./web-auth-types";

export function getWebAuthConfigPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function parseDisabled(value: string | undefined): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return "invalid";
}

export function readGateConfig(options: ReadGateConfigOptions = {}): GateConfig {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? getWebAuthConfigPath();
  const readFile = options.readFile ?? readFileSync;
  let fileAuth: { password?: string; disabled?: boolean } = {};

  try {
    const parsed: unknown = JSON.parse(readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "error", configPath, logMessage: `${configPath} must contain a JSON object` };
    }

    const auth = (parsed as { auth?: unknown }).auth;
    if (auth !== undefined) {
      if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
        return { status: "error", configPath, logMessage: `${configPath}: auth must be an object` };
      }
      const candidate = auth as { password?: unknown; disabled?: unknown };
      if (candidate.password !== undefined && typeof candidate.password !== "string") {
        return { status: "error", configPath, logMessage: `${configPath}: auth.password must be a string` };
      }
      if (candidate.disabled !== undefined && typeof candidate.disabled !== "boolean") {
        return { status: "error", configPath, logMessage: `${configPath}: auth.disabled must be a boolean` };
      }
      fileAuth = {
        password: candidate.password as string | undefined,
        disabled: candidate.disabled as boolean | undefined,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { status: "error", configPath, logMessage: `Failed to read ${configPath}: ${String(error)}` };
    }
  }

  const envDisabled = parseDisabled(env.PI_WEB_AUTH_DISABLED);
  if (envDisabled === "invalid") {
    return { status: "error", configPath, logMessage: "PI_WEB_AUTH_DISABLED must be true or false" };
  }

  const disabled = envDisabled ?? fileAuth.disabled ?? false;
  const password = env.PI_WEB_PASSWORD !== undefined ? env.PI_WEB_PASSWORD : fileAuth.password;
  if (disabled) return { status: "disabled", configPath };
  if (typeof password === "string" && password.trim()) {
    return { status: "enabled", configPath, password };
  }
  return { status: "unconfigured", configPath };
}

export function toPublicGateStatus(config: GateConfig): GatePublicStatus {
  return { status: config.status, configPath: config.configPath };
}
```

Do not trim the accepted password before storing it; use `trim()` only to reject whitespace-only values so a deliberate leading/trailing character remains part of the password.

- [ ] **Step 4: Run config tests and typecheck the new modules**

Run:

```bash
node --test lib/web-auth-config.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all config tests PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit the config module**

```bash
git add lib/web-auth-types.ts lib/web-auth-config.ts lib/web-auth-config.test.mjs
git commit -m "feat: add local auth configuration"
```

---

### Task 2: Sign and Verify Login Cookies

**Files:**
- Create: `lib/web-auth-session.ts`
- Test: `lib/web-auth-session.test.mjs`

**Interfaces:**
- Consumes: an enabled config password from Task 1 and an injected current time/random value for deterministic tests.
- Produces:

```ts
export const WEB_AUTH_COOKIE = "pi_web_session";
export const WEB_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionOptions = {
  now?: number;
  nonce?: string;
};

export type WebAuthCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function passwordsMatch(actual: string, expected: string): boolean;
export function createSessionToken(password: string, options?: SessionOptions): string;
export function verifySessionToken(token: string | undefined, password: string, now?: number): boolean;
export function getSessionCookieOptions(requestUrl: string): WebAuthCookieOptions;
export function getExpiredSessionCookieOptions(requestUrl: string): WebAuthCookieOptions;
```

- [ ] **Step 1: Write failing session tests**

Create `lib/web-auth-session.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const session = await jiti.import("./web-auth-session.ts");

test("compares correct and differently-sized passwords without throwing", () => {
  assert.equal(session.passwordsMatch("secret", "secret"), true);
  assert.equal(session.passwordsMatch("x", "much-longer-secret"), false);
  assert.equal(session.passwordsMatch("much-longer-secret", "x"), false);
});

test("creates a token that contains no plaintext password and verifies before expiry", () => {
  const now = 1_700_000_000_000;
  const token = session.createSessionToken("secret", { now, nonce: "fixed-nonce" });
  assert.equal(token.includes("secret"), false);
  assert.equal(session.verifySessionToken(token, "secret", now + 1_000), true);
});

test("rejects tampering, expiry, malformed values, and password changes", () => {
  const now = 1_700_000_000_000;
  const token = session.createSessionToken("old-secret", { now, nonce: "fixed-nonce" });
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(session.verifySessionToken(tampered, "old-secret", now), false);
  assert.equal(session.verifySessionToken(token, "new-secret", now), false);
  assert.equal(session.verifySessionToken(token, "old-secret", now + 31 * 24 * 60 * 60 * 1000), false);
  assert.equal(session.verifySessionToken("broken", "old-secret", now), false);
  assert.equal(session.verifySessionToken(undefined, "old-secret", now), false);
});

test("sets secure cookies only for HTTPS and expires with maxAge zero", () => {
  assert.deepEqual(session.getSessionCookieOptions("http://localhost:30141"), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: session.WEB_AUTH_MAX_AGE_SECONDS,
  });
  assert.equal(session.getSessionCookieOptions("https://pi.example").secure, true);
  assert.equal(session.getExpiredSessionCookieOptions("https://pi.example").maxAge, 0);
});
```

- [ ] **Step 2: Run the session tests and verify failure**

```bash
node --test lib/web-auth-session.test.mjs
```

Expected: FAIL because `lib/web-auth-session.ts` does not exist.

- [ ] **Step 3: Implement the signed token format**

Create `lib/web-auth-session.ts` using only `node:crypto`:

```ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const SESSION_KEY_CONTEXT = "pi-web-session-v1";

function safeEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function deriveKey(password: string): Buffer {
  return createHash("sha256").update(SESSION_KEY_CONTEXT).update("\0").update(password).digest();
}

function sign(payload: string, password: string): string {
  return createHmac("sha256", deriveKey(password)).update(payload).digest("base64url");
}

export function passwordsMatch(actual: string, expected: string): boolean {
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return safeEqual(left, right);
}
```

Use token payload `${TOKEN_VERSION}.${expiresAt}.${nonce}`, where `expiresAt` is `now + WEB_AUTH_MAX_AGE_SECONDS * 1000`, and the complete token is `${payload}.${signature}`. Verification must:

1. require exactly four dot-separated fields;
2. require `v1`;
3. require a finite numeric expiry greater than `now`;
4. recompute the signature and compare decoded buffers with `safeEqual`;
5. return `false` instead of throwing on every malformed token.

- [ ] **Step 4: Run session tests and typecheck**

```bash
node --test lib/web-auth-session.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all session tests PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit session signing**

```bash
git add lib/web-auth-session.ts lib/web-auth-session.test.mjs
git commit -m "feat: add signed auth sessions"
```

---

### Task 3: Decide Public Paths, Redirects, and Unauthorized Responses

**Files:**
- Create: `lib/web-auth-request.ts`
- Test: `lib/web-auth-request.test.mjs`

**Interfaces:**
- Consumes: `GateConfig` from Task 1, `verifySessionToken()` and `WEB_AUTH_COOKIE` from Task 2.
- Produces:

```ts
export type GateRequestInput = {
  url: string;
  method: string;
  sessionToken?: string;
};

export type GateDecision =
  | { action: "allow"; authStatus: "enabled" | "disabled" }
  | { action: "redirect"; location: string }
  | { action: "json"; status: 401 | 503; body: { error: string; code?: string } };

export function sanitizeNextPath(value: string | null | undefined): string;
export function isGatePublicPath(pathname: string): boolean;
export function isApiPath(pathname: string): boolean;
export function decideGateRequest(config: GateConfig, input: GateRequestInput): GateDecision;
```

- [ ] **Step 1: Write failing request-policy tests**

Create `lib/web-auth-request.test.mjs` with a table covering:

```js
const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
const disabled = { status: "disabled", configPath: "/tmp/pi-web.json" };
const unconfigured = { status: "unconfigured", configPath: "/tmp/pi-web.json" };
const broken = { status: "error", configPath: "/tmp/pi-web.json", logMessage: "bad json" };
```

Assertions must include:

```js
assert.equal(sanitizeNextPath("/api/sessions?x=1"), "/api/sessions?x=1");
for (const unsafe of ["//evil.example", "https://evil.example", "login", "/login", "/login?next=/", "/\nheader"]) {
  assert.equal(sanitizeNextPath(unsafe), "/");
}

for (const path of ["/login", "/api/gate/status", "/api/gate/login", "/api/gate/logout"]) {
  assert.equal(isGatePublicPath(path), true);
}
assert.equal(isGatePublicPath("/api/auth/providers"), false);

assert.deepEqual(
  decideGateRequest(disabled, { url: "http://localhost/api/sessions", method: "GET" }),
  { action: "allow", authStatus: "disabled" },
);
assert.deepEqual(
  decideGateRequest(enabled, { url: "http://localhost/api/sessions", method: "GET" }),
  { action: "json", status: 401, body: { error: "Unauthorized" } },
);
assert.deepEqual(
  decideGateRequest(unconfigured, { url: "http://localhost/api/sessions", method: "GET" }),
  { action: "json", status: 503, body: { error: "Authentication is not configured", code: "AUTH_NOT_CONFIGURED" } },
);
assert.deepEqual(
  decideGateRequest(broken, { url: "http://localhost/", method: "GET" }),
  { action: "redirect", location: "/login" },
);
```

Generate a real valid token with `createSessionToken("secret", ...)` and assert enabled requests are allowed. Assert unauthenticated page `/files?path=x` redirects to `/login?next=%2Ffiles%3Fpath%3Dx`. Assert public gate routes are allowed even when config is unconfigured/error so the login page can recover.

- [ ] **Step 2: Run request-policy tests and verify failure**

```bash
node --test lib/web-auth-request.test.mjs
```

Expected: FAIL because `lib/web-auth-request.ts` does not exist.

- [ ] **Step 3: Implement framework-neutral request decisions**

Implement exact-path public routes and keep static asset exclusion in `proxy.ts`'s matcher, not in this module. `sanitizeNextPath()` must:

```ts
export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/^[\u0000-\u001f\u007f]/.test(value) || /[\r\n]/.test(value)) return "/";
  const parsed = new URL(value, "http://pi-web.local");
  if (parsed.origin !== "http://pi-web.local") return "/";
  if (parsed.pathname === "/login") return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
```

For an enabled config, verify the cookie only after allowing the four public paths. For config errors, log details later in `proxy.ts`; decisions expose only safe response text.

- [ ] **Step 4: Run all auth-library tests and typecheck**

```bash
node --test lib/web-auth-config.test.mjs lib/web-auth-session.test.mjs lib/web-auth-request.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all tests PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit request policy**

```bash
git add lib/web-auth-request.ts lib/web-auth-request.test.mjs
git commit -m "feat: add auth request policy"
```

---

### Task 4: Throttle Repeated Failed Logins

**Files:**
- Create: `lib/web-auth-rate-limit.ts`
- Test: `lib/web-auth-rate-limit.test.mjs`

**Interfaces:**
- Consumes: client address string and optional test clock.
- Produces:

```ts
export type LoginAttemptStore = {
  failures: number;
  retryAt: number;
  expiresAt: number;
};

export function getLoginRetryAfterSeconds(key: string, now?: number): number;
export function recordLoginFailure(key: string, now?: number): number;
export function clearLoginFailures(key: string): void;
export function resetLoginRateLimitForTests(): void;
```

- [ ] **Step 1: Write failing backoff tests**

Create `lib/web-auth-rate-limit.test.mjs`:

```js
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const limiter = await jiti.import("./web-auth-rate-limit.ts");
afterEach(() => limiter.resetLoginRateLimitForTests());

test("first failures add bounded progressive delays", () => {
  const now = 1_700_000_000_000;
  assert.equal(limiter.recordLoginFailure("client", now), 1);
  assert.equal(limiter.getLoginRetryAfterSeconds("client", now), 1);
  assert.equal(limiter.recordLoginFailure("client", now + 1_000), 2);
  for (let i = 0; i < 20; i += 1) limiter.recordLoginFailure("client", now + 2_000 + i);
  assert.ok(limiter.getLoginRetryAfterSeconds("client", now + 2_000) <= 30);
});

test("success clears failures and expired records disappear", () => {
  const now = 1_700_000_000_000;
  limiter.recordLoginFailure("client", now);
  limiter.clearLoginFailures("client");
  assert.equal(limiter.getLoginRetryAfterSeconds("client", now), 0);
  limiter.recordLoginFailure("other", now);
  assert.equal(limiter.getLoginRetryAfterSeconds("other", now + 16 * 60 * 1000), 0);
});
```

Use delays `1, 2, 4, 8, 16, 30...` seconds and a 15-minute record lifetime.

- [ ] **Step 2: Run limiter tests and verify failure**

```bash
node --test lib/web-auth-rate-limit.test.mjs
```

Expected: FAIL because `lib/web-auth-rate-limit.ts` does not exist.

- [ ] **Step 3: Implement the bounded in-process map**

Use a module-level `Map<string, LoginAttemptStore>`. On every public function call, remove expired records. `recordLoginFailure()` increments failures, computes `Math.min(30, 2 ** (failures - 1))`, stores `retryAt` and `expiresAt`, and returns the delay. Do not trust `x-forwarded-for` blindly as multiple comma-separated identities; route code will use only the first trimmed address and fall back to `"unknown"`.

- [ ] **Step 4: Run limiter tests and typecheck**

```bash
node --test lib/web-auth-rate-limit.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: tests PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit the limiter**

```bash
git add lib/web-auth-rate-limit.ts lib/web-auth-rate-limit.test.mjs
git commit -m "feat: throttle failed auth attempts"
```

---

### Task 5: Add Status, Login, and Logout Routes

**Files:**
- Create: `app/api/gate/status/route.ts`
- Create: `app/api/gate/login/route.ts`
- Create: `app/api/gate/logout/route.ts`
- Test: `app/api/gate/routes.test.mjs`

**Interfaces:**
- Consumes: `readGateConfig()`, `toPublicGateStatus()`, `passwordsMatch()`, session token/cookie helpers, limiter helpers, and `sanitizeNextPath()`.
- Produces:
  - `GET /api/gate/status` → `GateStatusResponse` with `Cache-Control: no-store`.
  - `POST /api/gate/login` body `{ password?: unknown; next?: unknown }`.
  - Successful login → `200` `LoginSuccessResponse`, with `pi_web_session` cookie only when auth is enabled.
  - Bad credentials → `401` `LoginFailureResponse`.
  - Active backoff → `429`, `Retry-After`, and `retryAfterSeconds`.
  - Unconfigured/error → `503` with safe public state.
  - `POST /api/gate/logout` → `200 { ok: true }` and expired cookie.

- [ ] **Step 1: Write failing route-handler tests**

Create `app/api/gate/routes.test.mjs` and import handlers through `jiti`. Before each test, use a temp directory and set:

```js
process.env.PI_CODING_AGENT_DIR = tempDir;
delete process.env.PI_WEB_PASSWORD;
delete process.env.PI_WEB_AUTH_DISABLED;
```

Restore the original environment and delete the temp directory in `afterEach`. Write `pi-web.json` directly to the temp directory for each state.

Test cases:

```js
const statusResponse = await statusRoute.GET();
assert.equal(statusResponse.status, 200);
assert.equal(statusResponse.headers.get("cache-control"), "no-store");
assert.deepEqual(await statusResponse.json(), {
  status: "enabled",
  configPath: join(tempDir, "pi-web.json"),
});
```

```js
const loginResponse = await loginRoute.POST(new Request("http://localhost/api/gate/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
  body: JSON.stringify({ password: "secret", next: "/?session=abc" }),
}));
assert.equal(loginResponse.status, 200);
assert.match(loginResponse.headers.get("set-cookie") ?? "", /pi_web_session=/);
assert.deepEqual(await loginResponse.json(), { ok: true, next: "/?session=abc" });
```

Also assert:

- wrong password returns `401`, no `Set-Cookie`, and `{ ok:false, error:"密码不正确" }`;
- malformed JSON or non-string password returns `400` with a safe error;
- second immediate failed request for the same address returns `429` and `Retry-After`;
- success clears prior failures;
- `disabled: true` returns success without setting a session cookie;
- unconfigured/error return `503` and never expose internal parse/read details;
- external `next` returns `/`;
- logout returns `Set-Cookie` containing `Max-Age=0`.

Call `resetLoginRateLimitForTests()` between tests so one failure does not leak into another.

- [ ] **Step 2: Run route tests and verify failure**

```bash
node --test app/api/gate/routes.test.mjs
```

Expected: FAIL because the gate route files do not exist.

- [ ] **Step 3: Implement status and logout routes**

`app/api/gate/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readGateConfig, toPublicGateStatus } from "@/lib/web-auth-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(toPublicGateStatus(readGateConfig()), {
    headers: { "Cache-Control": "no-store" },
  });
}
```

`app/api/gate/logout/route.ts` creates `NextResponse.json({ ok: true })`, calls:

```ts
response.cookies.set(WEB_AUTH_COOKIE, "", getExpiredSessionCookieOptions(request.url));
```

and sets `Cache-Control: no-store`.

- [ ] **Step 4: Implement login route and safe error contracts**

Use:

```ts
function getClientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}
```

Control flow:

1. Read JSON in `try/catch`; reject malformed or non-string password with `400`.
2. Read config for every request.
3. If disabled, clear the address's failures and return `{ ok:true, next:sanitizeNextPath(next) }` without cookie.
4. If unconfigured/error, return `503` with safe `status`; log `config.logMessage` only on the server for `error`.
5. Check `getLoginRetryAfterSeconds()` before comparing. If positive, return `429`, `Retry-After`, and `retryAfterSeconds`.
6. Use `passwordsMatch()`; on failure call `recordLoginFailure()` and return `401`. The waiting period applies to the next attempt, so the first wrong response stays `401`.
7. On success clear failures, create a token, set the cookie with options derived from `request.url`, and return the sanitized `next`.

Always set `Cache-Control: no-store` on auth responses.

- [ ] **Step 5: Run route and library tests**

```bash
node --test \
  lib/web-auth-config.test.mjs \
  lib/web-auth-session.test.mjs \
  lib/web-auth-request.test.mjs \
  lib/web-auth-rate-limit.test.mjs \
  app/api/gate/routes.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all tests PASS; TypeScript reports no errors.

- [ ] **Step 6: Commit the gate routes**

```bash
git add app/api/gate/status/route.ts app/api/gate/login/route.ts app/api/gate/logout/route.ts app/api/gate/routes.test.mjs
git commit -m "feat: add password login routes"
```

---

### Task 6: Protect Pages and APIs with Next.js Proxy

**Files:**
- Create: `proxy.ts`
- Test: `lib/web-auth-proxy.test.mjs`

**Interfaces:**
- Consumes: `NextRequest`, `NextResponse`, `readGateConfig()`, `decideGateRequest()`, and `WEB_AUTH_COOKIE`.
- Produces:

```ts
export function proxy(request: NextRequest): NextResponse;
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 1: Write failing proxy tests**

Create `lib/web-auth-proxy.test.mjs`, import `NextRequest` from `next/server.js`, and import `{ proxy, config }` through `jiti`. Use temp `PI_CODING_AGENT_DIR` configuration as in route tests.

Required assertions:

```js
const pageResponse = await proxy(new NextRequest("http://localhost/?session=abc"));
assert.equal(pageResponse.status, 307);
assert.equal(pageResponse.headers.get("location"), "http://localhost/login?next=%2F%3Fsession%3Dabc");
```

```js
const apiResponse = await proxy(new NextRequest("http://localhost/api/sessions"));
assert.equal(apiResponse.status, 401);
assert.deepEqual(await apiResponse.json(), { error: "Unauthorized" });
```

Also cover:

- unconfigured API returns `503` and `AUTH_NOT_CONFIGURED`;
- malformed config API returns `503` and does not expose parse details;
- `/login` and all three `/api/gate/*` routes pass through;
- `/api/auth/providers` is protected;
- disabled config passes through and adds `x-pi-web-auth-status: disabled` to the request forwarded downstream;
- enabled valid cookie passes through and adds `x-pi-web-auth-status: enabled`;
- enabled invalid cookie redirects/401s;
- matcher excludes `/_next/static/...`, `/_next/image?...`, and `/favicon.ico` while matching `/`, `/api/sessions`, and `/api/auth/providers`.

Before importing the Next test utility in Node 24, install Node's `AsyncLocalStorage` on `globalThis` because the package expects the Next runtime bootstrap to have done that:

```js
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
```

Then call it with `{ config, url }` to test matcher behavior. Keep the actual app imports unchanged (`next/server`); only standalone `.mjs` tests need the explicit `.js` package entry and bootstrap.

- [ ] **Step 2: Run proxy tests and verify failure**

```bash
node --test lib/web-auth-proxy.test.mjs
```

Expected: FAIL because `proxy.ts` does not exist.

- [ ] **Step 3: Implement the proxy adapter**

`proxy.ts` should remain thin:

```ts
import { NextRequest, NextResponse } from "next/server";
import { readGateConfig } from "@/lib/web-auth-config";
import { decideGateRequest } from "@/lib/web-auth-request";
import { WEB_AUTH_COOKIE } from "@/lib/web-auth-session";

export function proxy(request: NextRequest) {
  const gateConfig = readGateConfig();
  if (gateConfig.status === "error") console.error(gateConfig.logMessage);

  const decision = decideGateRequest(gateConfig, {
    url: request.url,
    method: request.method,
    sessionToken: request.cookies.get(WEB_AUTH_COOKIE)?.value,
  });

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  if (decision.action === "json") {
    return NextResponse.json(decision.body, {
      status: decision.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const headers = new Headers(request.headers);
  headers.set("x-pi-web-auth-status", decision.authStatus);
  return NextResponse.next({ request: { headers } });
}
```

The request header is internal state passed to pages/components; do not accept a client-supplied value without overwriting it.

Use a constant matcher exactly covering all non-static app paths. Do not exclude `/api`; all business APIs must pass through the proxy.

- [ ] **Step 4: Run proxy, route, and library tests**

```bash
node --test \
  lib/web-auth-config.test.mjs \
  lib/web-auth-session.test.mjs \
  lib/web-auth-request.test.mjs \
  lib/web-auth-rate-limit.test.mjs \
  app/api/gate/routes.test.mjs \
  lib/web-auth-proxy.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: all tests PASS; TypeScript reports no errors.

- [ ] **Step 5: Commit whole-app protection**

```bash
git add proxy.ts lib/web-auth-proxy.test.mjs
git commit -m "feat: protect app with password proxy"
```

---

### Task 7: Build the Login Page

**Files:**
- Create: `components/LoginForm.tsx`
- Create: `app/login/page.tsx`
- Test: `components/LoginForm.test.mjs`

**Interfaces:**
- Consumes: `GateStatusResponse`, `LoginSuccessResponse`, and `LoginFailureResponse` from `lib/web-auth-types.ts`; `/api/gate/status`; `/api/gate/login`.
- Produces:

```ts
export type LoginFormProps = {
  nextPath?: string;
};

export function LoginForm({ nextPath = "/" }: LoginFormProps): React.ReactElement;
```

- [ ] **Step 1: Write failing login UI contract tests**

Follow the repository's existing component source-contract style (`components/AppShell.workspace.test.mjs`). Create `components/LoginForm.test.mjs` that reads `LoginForm.tsx` and `app/login/page.tsx`, then asserts:

```js
assert.match(formSource, /fetch\("\/api\/gate\/status"/);
assert.match(formSource, /fetch\("\/api\/gate\/login"/);
assert.match(formSource, /autoComplete="current-password"/);
assert.match(formSource, /type="password"/);
assert.match(formSource, /PI_WEB_PASSWORD/);
assert.match(formSource, /PI_WEB_AUTH_DISABLED/);
assert.match(formSource, /认证配置无法读取/);
assert.match(formSource, /window\.location\.assign\(data\.next\)/);
assert.match(pageSource, /<Suspense/);
assert.match(pageSource, /<LoginForm/);
```

Also assert there is no `dangerouslySetInnerHTML`, no `NEXT_PUBLIC` password variable, and no rendering of an arbitrary server error object.

- [ ] **Step 2: Run UI contract tests and verify failure**

```bash
node --test components/LoginForm.test.mjs
```

Expected: FAIL because the component and page do not exist.

- [ ] **Step 3: Implement `LoginForm` status loading and submission**

Create a client component with state:

```ts
const [status, setStatus] = useState<GateStatusResponse | null>(null);
const [password, setPassword] = useState("");
const [error, setError] = useState<string | null>(null);
const [submitting, setSubmitting] = useState(false);
```

On mount, fetch `/api/gate/status` with `{ cache: "no-store" }`; if the request itself fails, show a generic “无法读取认证状态” message.

Submit exact contract:

```ts
const response = await fetch("/api/gate/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password, next: nextPath }),
});
const data = await response.json() as LoginSuccessResponse | LoginFailureResponse;
if (!response.ok || !data.ok) {
  setError(data.ok ? "登录失败" : data.error);
  return;
}
window.location.assign(data.next);
```

For a `429`, include the public `retryAfterSeconds` in a simple message without exposing failure counts. Clear the password state on wrong credentials. Disable input/button while submitting.

Render branches:

- loading: `正在读取认证配置…`;
- enabled: password field + Login button + error;
- unconfigured: actual `configPath`, JSON sample, `PI_WEB_PASSWORD`, `PI_WEB_AUTH_DISABLED=true`, `chmod 600`, restart note; no password field;
- error: `认证配置无法读取`, `configPath`, repair/restart instruction; no internal details;
- disabled: warning and `<a href="/">进入 Pi Agent Web</a>`.

Use existing CSS variables, a scrollable full-height wrapper, and inline styles. Do not add a global stylesheet for this isolated page.

- [ ] **Step 4: Implement `/login` page with Suspense**

Use a client search-param reader inside `LoginForm` or a small page wrapper. The simplest repository-consistent version is:

```tsx
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

If `LoginForm` uses `useSearchParams()`, compute `nextPath = searchParams.get("next") ?? "/"`; the server re-sanitizes it, so the client must never be the security boundary.

- [ ] **Step 5: Run login UI tests and typecheck**

```bash
node --test components/LoginForm.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: UI contract tests PASS; TypeScript reports no errors.

- [ ] **Step 6: Commit the login page**

```bash
git add components/LoginForm.tsx app/login/page.tsx components/LoginForm.test.mjs
git commit -m "feat: add password login page"
```

---

### Task 8: Add Logout and Bypass Warning to the Top Bar

**Files:**
- Create: `components/AuthControls.tsx`
- Create: `components/AuthControls.test.mjs`
- Create: `components/AppShell.auth.test.mjs`
- Modify: `components/AppShell.tsx:1-18, 542-798`

**Interfaces:**
- Consumes: `GET /api/gate/status`, `POST /api/gate/logout`, `GateStatusResponse`, and `useIsMobile()`.
- Produces:

```ts
export function AuthControls(): React.ReactElement | null;
```

- [ ] **Step 1: Write failing auth-controls and AppShell integration tests**

`components/AuthControls.test.mjs` reads the source and asserts:

```js
assert.match(source, /fetch\("\/api\/gate\/status"/);
assert.match(source, /fetch\("\/api\/gate\/logout"/);
assert.match(source, /method:\s*"POST"/);
assert.match(source, /window\.location\.assign\("\/login"\)/);
assert.match(source, /认证已关闭/);
assert.match(source, /configPath/);
assert.match(source, /aria-label/);
```

`components/AppShell.auth.test.mjs` reads `AppShell.tsx` and asserts the import and `<AuthControls />` occur inside the top-bar block but outside the conditional `showChat && (sessionStats || contextUsage)` block. Use string indices, as existing `AppShell.workspace.test.mjs` does, to make the layout contract explicit.

- [ ] **Step 2: Run auth-controls tests and verify failure**

```bash
node --test components/AuthControls.test.mjs components/AppShell.auth.test.mjs
```

Expected: FAIL because `AuthControls.tsx` does not exist and AppShell has no auth integration.

- [ ] **Step 3: Implement focused auth controls**

Create a client component with `status`, `loading`, and `loggingOut` state. Fetch status once on mount with `cache: "no-store"`.

For `enabled`, render a 36px-high top-bar button:

```ts
async function handleLogout() {
  setLoggingOut(true);
  try {
    const response = await fetch("/api/gate/logout", { method: "POST" });
    if (!response.ok) throw new Error("logout failed");
    window.location.assign("/login");
  } finally {
    setLoggingOut(false);
  }
}
```

For `disabled`, render an amber/red warning with `title={\`认证已关闭。配置：${status.configPath}\`}`. On mobile, show only a warning icon with an `aria-label` containing the path; on desktop show `认证已关闭` and a truncated path. For `unconfigured`/`error`, return `null` because the proxy should prevent the main app from being reached in those states.

- [ ] **Step 4: Mount controls without colliding with fixed right buttons**

In `components/AppShell.tsx`:

1. import `AuthControls` near other component imports;
2. wrap session stats and `AuthControls` in one right-aligned flex container with `marginLeft: "auto"`;
3. move the existing stats button's `marginLeft: "auto"` to that wrapper;
4. keep `paddingRight: rightPanelMode === "closed" ? 84 : 12` on the wrapper so the fixed Explorer/File buttons at the top right retain their 72px space;
5. render `<AuthControls />` even when `showChat` is false or session stats are absent;
6. keep the top bar at 36px and give auth controls `flexShrink: 0`.

Do not put auth controls into the `position: fixed` Explorer/File group at `components/AppShell.tsx:1052-1111`.

- [ ] **Step 5: Run component tests and typecheck**

```bash
node --test \
  components/AuthControls.test.mjs \
  components/AppShell.auth.test.mjs \
  components/AppShell.workspace.test.mjs
node_modules/.bin/tsc --noEmit
```

Expected: new auth tests and existing workspace regression tests PASS; TypeScript reports no errors.

- [ ] **Step 6: Commit the main-app controls**

```bash
git add components/AuthControls.tsx components/AuthControls.test.mjs components/AppShell.auth.test.mjs components/AppShell.tsx
git commit -m "feat: add auth controls to app shell"
```

---

### Task 9: Document Local Configuration and Security Boundaries

**Files:**
- Modify: `README.md:45-58`
- Modify: `README.zh-CN.md:41-54`
- Modify: `AGENTS.md:35-70, 125-180`

**Interfaces:**
- Consumes: final config field names, paths, environment variables, route names, and behavior implemented in Tasks 1-8.
- Produces: user setup instructions and durable maintenance notes.

- [ ] **Step 1: Add English README authentication setup**

Add a “Local password authentication” subsection showing:

```json
{
  "auth": {
    "password": "replace-with-a-strong-password",
    "disabled": false
  }
}
```

Document:

```bash
chmod 600 ~/.pi/agent/pi-web.json
PI_WEB_PASSWORD=replace-with-a-strong-password pi-web
PI_WEB_AUTH_DISABLED=true pi-web
```

State that the file follows `PI_CODING_AGENT_DIR`, environment variables override file fields, missing/invalid config locks the app, changes should be followed by a restart, and `disabled: true` removes the entire application gate. Recommend HTTPS plus firewall/reverse-proxy restrictions for LAN/public deployment.

- [ ] **Step 2: Add matching Chinese README instructions**

Use direct Chinese wording and the same commands/JSON. Explicitly distinguish Pi Agent Web login from the existing model-provider login/API-key controls.

- [ ] **Step 3: Update AGENTS.md file map and traps**

Add:

```text
app/login/page.tsx
app/api/gate/status/route.ts
app/api/gate/login/route.ts
app/api/gate/logout/route.ts
lib/web-auth-config.ts
lib/web-auth-session.ts
lib/web-auth-request.ts
lib/web-auth-rate-limit.ts
components/LoginForm.tsx
components/AuthControls.tsx
proxy.ts
```

Record these traps:

- `app/api/auth/*` is model-provider auth, while `/api/gate/*` is the application password gate.
- Missing/invalid `pi-web.json` must lock; only explicit `disabled: true` bypasses.
- `proxy.ts` is the Next.js 16 filename; do not reintroduce `middleware.ts`.
- All business APIs, including SSE and provider auth, stay inside the matcher.
- Password changes invalidate cookies because the signing key derives from the current password.
- Never return config `logMessage` to the browser.

- [ ] **Step 4: Verify docs contain exact configuration names**

```bash
rg -n "pi-web\.json|PI_WEB_PASSWORD|PI_WEB_AUTH_DISABLED|disabled.*true|HTTPS|/api/gate" README.md README.zh-CN.md AGENTS.md
```

Expected: all three documents contain the relevant exact names; English and Chinese READMEs contain setup, bypass, and deployment warnings.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md README.zh-CN.md AGENTS.md
git commit -m "docs: explain local password authentication"
```

---

### Task 10: Run Full Verification and Security Regression Checks

**Files:**
- Verify all files created or modified in Tasks 1-9.

**Interfaces:**
- Consumes: completed implementation.
- Produces: evidence that the feature meets the approved design without breaking existing contracts.

- [ ] **Step 1: Run every authentication test plus existing related component tests**

```bash
node --test \
  lib/web-auth-config.test.mjs \
  lib/web-auth-session.test.mjs \
  lib/web-auth-request.test.mjs \
  lib/web-auth-rate-limit.test.mjs \
  app/api/gate/routes.test.mjs \
  lib/web-auth-proxy.test.mjs \
  components/LoginForm.test.mjs \
  components/AuthControls.test.mjs \
  components/AppShell.auth.test.mjs \
  components/AppShell.workspace.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the complete repository Node test suite**

```bash
node --test
```

Expected: all repository tests PASS. If Node's default discovery omits repository `.test.mjs` files, run:

```bash
node --test $(find . -path './node_modules' -prune -o -path './.next' -prune -o -name '*.test.mjs' -print)
```

Expected: all discovered tests PASS.

- [ ] **Step 3: Run typecheck and lint**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: both commands exit 0. Do not run `next build`.

- [ ] **Step 4: Run a manual HTTP smoke test in dev mode**

Start the server in one terminal:

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run dev
```

With no config file, verify from another terminal:

```bash
curl -i http://localhost:30141/
curl -i http://localhost:30141/api/sessions
curl -i http://localhost:30141/api/gate/status
```

Expected:

- `/` redirects to `/login`;
- `/api/sessions` returns `503` with `AUTH_NOT_CONFIGURED`;
- `/api/gate/status` returns `unconfigured` plus the temp config path.

Create `<temp>/pi-web.json` with password `secret`, restart dev server, then:

```bash
curl -i -c /tmp/pi-web-cookie.txt \
  -H 'content-type: application/json' \
  --data '{"password":"secret","next":"/"}' \
  http://localhost:30141/api/gate/login
curl -i -b /tmp/pi-web-cookie.txt http://localhost:30141/api/sessions
curl -i -b /tmp/pi-web-cookie.txt -X POST http://localhost:30141/api/gate/logout
```

Expected: login sets `pi_web_session`, authenticated sessions request is no longer rejected by the gate, and logout expires the cookie. Stop the dev server and remove temp files afterward.

- [ ] **Step 5: Inspect the final diff for sensitive-data leaks and scope creep**

```bash
git diff --check
git diff --stat
git diff -- \
  proxy.ts \
  lib/web-auth-types.ts \
  lib/web-auth-config.ts \
  lib/web-auth-session.ts \
  lib/web-auth-request.ts \
  lib/web-auth-rate-limit.ts \
  app/api/gate \
  app/login \
  components/LoginForm.tsx \
  components/AuthControls.tsx \
  components/AppShell.tsx \
  README.md README.zh-CN.md AGENTS.md
rg -n "password.*(json|return)|logMessage|NEXT_PUBLIC.*PASSWORD|console\.log.*password" \
  proxy.ts lib/web-auth-*.ts app/api/gate components/LoginForm.tsx components/AuthControls.tsx
```

Expected: no whitespace errors; no password/log detail is returned or logged; no unrelated refactor; `console.error(config.logMessage)` exists only server-side for configuration diagnostics.

- [ ] **Step 6: Request independent code review**

Invoke `superpowers:requesting-code-review`, providing the approved design, this plan, all changed paths, and the security-sensitive areas: locked default, route matcher coverage, cookie verification, redirect sanitization, rate limiting, and no secret exposure.

Expected: reviewer reports no blocking issue. Resolve every blocking finding and rerun Steps 1-5 before continuing.

- [ ] **Step 7: Commit any verification fixes**

If review or verification required changes:

```bash
git add <fixed-files>
git commit -m "fix: address auth verification findings"
```

If no files changed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: configuration location/precedence, explicit bypass, locked default, password-bound 30-day cookie, login/logout/status routes, full proxy coverage, safe redirects, backoff, login/config-help UI, top-bar logout/warning, docs, and verification each have an implementation task.
- Placeholder scan: no unfinished placeholder, unnamed error handling, or undefined follow-up task remains.
- Type consistency: `GateConfig`, `GatePublicStatus`, `GateStatusResponse`, login response types, cookie helpers, request decisions, and component API names are defined once and used consistently by later tasks.
