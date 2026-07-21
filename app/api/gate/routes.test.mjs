import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
});

const limiter = await jiti.import("../../../lib/web-auth-rate-limit.ts");

const originalEnv = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_WEB_PASSWORD: process.env.PI_WEB_PASSWORD,
  PI_WEB_AUTH_DISABLED: process.env.PI_WEB_AUTH_DISABLED,
};

let tempDir;
let statusRoute;
let loginRoute;
let logoutRoute;

function writeConfig(auth) {
  writeFileSync(join(tempDir, "pi-web.json"), JSON.stringify({ auth }), "utf8");
}

function loginRequest(body, headers = {}) {
  return new Request("http://localhost/api/gate/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "pi-web-gate-routes-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  delete process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_AUTH_DISABLED;
  limiter.resetLoginRateLimitForTests();

  statusRoute = await jiti.import("./status/route.ts");
  loginRoute = await jiti.import("./login/route.ts");
  logoutRoute = await jiti.import("./logout/route.ts");
});

afterEach(() => {
  limiter.resetLoginRateLimitForTests();
  if (originalEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalEnv.PI_CODING_AGENT_DIR;
  if (originalEnv.PI_WEB_PASSWORD === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalEnv.PI_WEB_PASSWORD;
  if (originalEnv.PI_WEB_AUTH_DISABLED === undefined) delete process.env.PI_WEB_AUTH_DISABLED;
  else process.env.PI_WEB_AUTH_DISABLED = originalEnv.PI_WEB_AUTH_DISABLED;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("status returns public enabled state with no-store", async () => {
  writeConfig({ password: "secret", disabled: false });
  const statusResponse = await statusRoute.GET();
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await statusResponse.json(), {
    status: "enabled",
    configPath: join(tempDir, "pi-web.json"),
  });
});

test("login succeeds with session cookie and sanitized next", async () => {
  writeConfig({ password: "secret", disabled: false });
  const loginResponse = await loginRoute.POST(loginRequest({
    password: "secret",
    next: "/?session=abc",
  }));
  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.headers.get("cache-control"), "no-store");
  assert.match(loginResponse.headers.get("set-cookie") ?? "", /pi_web_session=/);
  assert.doesNotMatch(loginResponse.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.deepEqual(await loginResponse.json(), { ok: true, next: "/?session=abc" });
});

test("wrong password returns 401 without cookie", async () => {
  writeConfig({ password: "secret", disabled: false });
  const loginResponse = await loginRoute.POST(loginRequest({ password: "wrong" }));
  assert.equal(loginResponse.status, 401);
  assert.equal(loginResponse.headers.get("cache-control"), "no-store");
  assert.equal(loginResponse.headers.get("set-cookie"), null);
  assert.deepEqual(await loginResponse.json(), { ok: false, error: "密码不正确" });
});

test("malformed JSON and non-string password return 400", async () => {
  writeConfig({ password: "secret", disabled: false });

  const malformed = await loginRoute.POST(loginRequest("{not-json"));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "no-store");
  assert.equal(malformed.headers.get("set-cookie"), null);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.ok, false);
  assert.equal(typeof malformedBody.error, "string");
  assert.ok(malformedBody.error.length > 0);
  assert.doesNotMatch(malformedBody.error, /not-json|SyntaxError|Unexpected/i);

  const badPassword = await loginRoute.POST(loginRequest({ password: 123 }));
  assert.equal(badPassword.status, 400);
  assert.equal(badPassword.headers.get("set-cookie"), null);
  const badBody = await badPassword.json();
  assert.equal(badBody.ok, false);
  assert.equal(typeof badBody.error, "string");
});

test("second immediate failed request for same address returns 429", async () => {
  writeConfig({ password: "secret", disabled: false });

  const first = await loginRoute.POST(loginRequest({ password: "wrong" }));
  assert.equal(first.status, 401);

  const second = await loginRoute.POST(loginRequest({ password: "wrong" }));
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("cache-control"), "no-store");
  const retryAfter = second.headers.get("retry-after");
  assert.ok(retryAfter);
  assert.match(retryAfter, /^\d+$/);
  assert.equal(second.headers.get("set-cookie"), null);
  const body = await second.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string");
  assert.equal(body.retryAfterSeconds, Number(retryAfter));
  assert.ok(body.retryAfterSeconds > 0);
});

test("successful login clears prior failures", async () => {
  writeConfig({ password: "secret", disabled: false });

  const firstFail = await loginRoute.POST(loginRequest({ password: "wrong" }));
  assert.equal(firstFail.status, 401);

  // Waiting period from the first failure applies to the next attempt.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const success = await loginRoute.POST(loginRequest({ password: "secret" }));
  assert.equal(success.status, 200);
  assert.match(success.headers.get("set-cookie") ?? "", /pi_web_session=/);

  const secondFail = await loginRoute.POST(loginRequest({ password: "wrong" }));
  assert.equal(secondFail.status, 401);
});

test("disabled auth returns success without session cookie", async () => {
  writeConfig({ disabled: true });
  const loginResponse = await loginRoute.POST(loginRequest({
    password: "anything",
    next: "/sessions",
  }));
  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.headers.get("cache-control"), "no-store");
  assert.equal(loginResponse.headers.get("set-cookie"), null);
  assert.deepEqual(await loginResponse.json(), { ok: true, next: "/sessions" });
});

test("unconfigured and error return safe 503 without internal details", async () => {
  writeConfig({});
  const unconfigured = await loginRoute.POST(loginRequest({ password: "secret" }));
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get("cache-control"), "no-store");
  assert.equal(unconfigured.headers.get("set-cookie"), null);
  const unconfiguredBody = await unconfigured.json();
  assert.equal(unconfiguredBody.ok, false);
  assert.equal(unconfiguredBody.status, "unconfigured");
  assert.equal(typeof unconfiguredBody.error, "string");
  assert.doesNotMatch(JSON.stringify(unconfiguredBody), /logMessage|ENOENT|EACCES|password|secret/i);

  writeFileSync(join(tempDir, "pi-web.json"), "{not-json", "utf8");
  const broken = await loginRoute.POST(loginRequest({ password: "secret" }));
  assert.equal(broken.status, 503);
  assert.equal(broken.headers.get("set-cookie"), null);
  const brokenBody = await broken.json();
  assert.equal(brokenBody.ok, false);
  assert.equal(brokenBody.status, "error");
  assert.equal(typeof brokenBody.error, "string");
  assert.doesNotMatch(JSON.stringify(brokenBody), /logMessage|not-json|SyntaxError|Failed to read|EACCES/i);
});

test("external next is sanitized to root", async () => {
  writeConfig({ password: "secret", disabled: false });
  const loginResponse = await loginRoute.POST(loginRequest({
    password: "secret",
    next: "https://evil.example",
  }));
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), { ok: true, next: "/" });
});

test("logout expires session cookie with Max-Age=0", async () => {
  const logoutResponse = await logoutRoute.POST(new Request("http://localhost/api/gate/logout", {
    method: "POST",
  }));
  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await logoutResponse.json(), { ok: true });
  const setCookie = logoutResponse.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /pi_web_session=/);
  assert.match(setCookie, /Max-Age=0/i);
});
