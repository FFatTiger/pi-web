import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const { NextRequest } = await import("next/server.js");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
});

const session = await jiti.import("./web-auth-session.ts");

const originalEnv = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_WEB_PASSWORD: process.env.PI_WEB_PASSWORD,
  PI_WEB_AUTH_DISABLED: process.env.PI_WEB_AUTH_DISABLED,
};

let tempDir;
let proxy;
let config;

function writeConfig(auth) {
  writeFileSync(join(tempDir, "pi-web.json"), JSON.stringify({ auth }), "utf8");
}

function request(url, { cookie, headers: extraHeaders } = {}) {
  const headers = { ...extraHeaders };
  if (cookie) headers.cookie = `${session.WEB_AUTH_COOKIE}=${cookie}`;
  return new NextRequest(url, Object.keys(headers).length > 0 ? { headers } : undefined);
}

function getForwardedAuthStatus(response) {
  return response.headers.get("x-middleware-request-x-pi-web-auth-status");
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "pi-web-proxy-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  delete process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_AUTH_DISABLED;

  const mod = await jiti.import("../proxy.ts");
  proxy = mod.proxy;
  config = mod.config;
});

afterEach(() => {
  if (originalEnv.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalEnv.PI_CODING_AGENT_DIR;
  if (originalEnv.PI_WEB_PASSWORD === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalEnv.PI_WEB_PASSWORD;
  if (originalEnv.PI_WEB_AUTH_DISABLED === undefined) delete process.env.PI_WEB_AUTH_DISABLED;
  else process.env.PI_WEB_AUTH_DISABLED = originalEnv.PI_WEB_AUTH_DISABLED;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

test("unauthenticated page redirects to login with next", async () => {
  writeConfig({ password: "secret", disabled: false });
  const pageResponse = await proxy(request("http://localhost/?session=abc"));
  assert.equal(pageResponse.status, 307);
  assert.equal(
    pageResponse.headers.get("location"),
    "http://localhost/login?next=%2F%3Fsession%3Dabc",
  );
});

test("unauthenticated API returns 401 Unauthorized", async () => {
  writeConfig({ password: "secret", disabled: false });
  const apiResponse = await proxy(request("http://localhost/api/sessions"));
  assert.equal(apiResponse.status, 401);
  assert.equal(apiResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await apiResponse.json(), { error: "Unauthorized" });
});

test("protected auth providers API is not public", async () => {
  writeConfig({ password: "secret", disabled: false });
  const apiResponse = await proxy(request("http://localhost/api/auth/providers"));
  assert.equal(apiResponse.status, 401);
  assert.deepEqual(await apiResponse.json(), { error: "Unauthorized" });
});

test("unconfigured API returns 503 AUTH_NOT_CONFIGURED", async () => {
  writeConfig({});
  const apiResponse = await proxy(request("http://localhost/api/sessions"));
  assert.equal(apiResponse.status, 503);
  assert.equal(apiResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await apiResponse.json(), {
    error: "Authentication is not configured",
    code: "AUTH_NOT_CONFIGURED",
  });
});

test("malformed config API returns 503 without parse details", async () => {
  writeFileSync(join(tempDir, "pi-web.json"), "{not-json", "utf8");
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    const apiResponse = await proxy(request("http://localhost/api/sessions"));
    assert.equal(apiResponse.status, 503);
    assert.equal(apiResponse.headers.get("cache-control"), "no-store");
    const body = await apiResponse.json();
    assert.deepEqual(body, {
      error: "Authentication configuration error",
      code: "AUTH_CONFIG_ERROR",
    });
    assert.doesNotMatch(JSON.stringify(body), /not-json|SyntaxError|Failed to read|logMessage/i);
    assert.ok(errors.length >= 1);
    assert.match(errors.join("\n"), /Failed to read|not-json|SyntaxError|JSON/i);
  } finally {
    console.error = originalError;
  }
});

test("login and gate routes pass through", async () => {
  writeConfig({ password: "secret", disabled: false });
  for (const path of ["/login", "/api/gate/status", "/api/gate/login", "/api/gate/logout"]) {
    const response = await proxy(request(`http://localhost${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(getForwardedAuthStatus(response), "enabled");
  }
});

test("authenticated /login redirects to safe next", async () => {
  writeConfig({ password: "secret", disabled: false });
  const token = session.createSessionToken("secret");

  const withNext = await proxy(
    request("http://localhost/login?next=%2Ffiles%3Fpath%3Dx", { cookie: token }),
  );
  assert.equal(withNext.status, 307);
  assert.equal(withNext.headers.get("location"), "http://localhost/files?path=x");

  const withoutNext = await proxy(request("http://localhost/login", { cookie: token }));
  assert.equal(withoutNext.status, 307);
  assert.equal(withoutNext.headers.get("location"), "http://localhost/");
});

test("disabled config passes through with disabled auth status header", async () => {
  writeConfig({ disabled: true });
  const response = await proxy(request("http://localhost/api/sessions"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(getForwardedAuthStatus(response), "disabled");
});

test("enabled valid cookie passes through with enabled auth status header", async () => {
  writeConfig({ password: "secret", disabled: false });
  const token = session.createSessionToken("secret");
  const response = await proxy(request("http://localhost/api/sessions", { cookie: token }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(getForwardedAuthStatus(response), "enabled");
});

test("enabled invalid cookie redirects pages and 401s APIs", async () => {
  writeConfig({ password: "secret", disabled: false });

  const pageResponse = await proxy(request("http://localhost/files", { cookie: "not-a-valid-token" }));
  assert.equal(pageResponse.status, 307);
  assert.equal(pageResponse.headers.get("location"), "http://localhost/login?next=%2Ffiles");

  const apiResponse = await proxy(request("http://localhost/api/sessions", { cookie: "not-a-valid-token" }));
  assert.equal(apiResponse.status, 401);
  assert.deepEqual(await apiResponse.json(), { error: "Unauthorized" });
});

test("overwrites client-spoofed x-pi-web-auth-status with actual decision", async () => {
  writeConfig({ password: "secret", disabled: false });
  const token = session.createSessionToken("secret");
  const enabledResponse = await proxy(
    request("http://localhost/api/sessions", {
      cookie: token,
      headers: { "x-pi-web-auth-status": "disabled" },
    }),
  );
  assert.equal(enabledResponse.status, 200);
  assert.equal(enabledResponse.headers.get("x-middleware-next"), "1");
  assert.equal(getForwardedAuthStatus(enabledResponse), "enabled");

  writeConfig({ disabled: true });
  const disabledResponse = await proxy(
    request("http://localhost/api/sessions", {
      headers: { "x-pi-web-auth-status": "enabled" },
    }),
  );
  assert.equal(disabledResponse.status, 200);
  assert.equal(disabledResponse.headers.get("x-middleware-next"), "1");
  assert.equal(getForwardedAuthStatus(disabledResponse), "disabled");
});

test("matcher covers app paths and excludes static assets", () => {
  assert.deepEqual(config.matcher, ["/((?!_next/static|_next/image|favicon.ico).*)"]);

  for (const url of [
    "http://localhost/",
    "http://localhost/api/sessions",
    "http://localhost/api/auth/providers",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), true, url);
  }

  for (const url of [
    "http://localhost/_next/static/chunk.js",
    "http://localhost/_next/image?url=%2Flogo.png",
    "http://localhost/favicon.ico",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url }), false, url);
  }
});
