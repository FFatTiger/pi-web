import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const request = await jiti.import("./web-auth-request.ts");
const session = await jiti.import("./web-auth-session.ts");

const {
  sanitizeNextPath,
  isGatePublicPath,
  isApiPath,
  decideGateRequest,
} = request;

const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
const disabled = { status: "disabled", configPath: "/tmp/pi-web.json" };
const unconfigured = { status: "unconfigured", configPath: "/tmp/pi-web.json" };
const broken = { status: "error", configPath: "/tmp/pi-web.json", logMessage: "bad json" };

test("sanitizeNextPath keeps safe same-origin relative paths", () => {
  assert.equal(sanitizeNextPath("/api/sessions?x=1"), "/api/sessions?x=1");
  assert.equal(sanitizeNextPath("/files?path=x#top"), "/files?path=x#top");
});

test("sanitizeNextPath rejects open redirects and control characters", () => {
  for (const unsafe of ["//evil.example", "https://evil.example", "login", "/login", "/login?next=/", "/\nheader"]) {
    assert.equal(sanitizeNextPath(unsafe), "/");
  }
  assert.equal(sanitizeNextPath(null), "/");
  assert.equal(sanitizeNextPath(undefined), "/");
  assert.equal(sanitizeNextPath(""), "/");
});

test("marks only exact gate public paths as public", () => {
  for (const path of ["/login", "/api/gate/status", "/api/gate/login", "/api/gate/logout"]) {
    assert.equal(isGatePublicPath(path), true);
  }
  assert.equal(isGatePublicPath("/api/auth/providers"), false);
  assert.equal(isGatePublicPath("/api/gate/status/extra"), false);
  assert.equal(isGatePublicPath("/login/extra"), false);
});

test("detects API paths", () => {
  assert.equal(isApiPath("/api/sessions"), true);
  assert.equal(isApiPath("/api"), true);
  assert.equal(isApiPath("/files"), false);
  assert.equal(isApiPath("/login"), false);
});

test("disabled config allows all requests", () => {
  assert.deepEqual(
    decideGateRequest(disabled, { url: "http://localhost/api/sessions", method: "GET" }),
    { action: "allow", authStatus: "disabled" },
  );
  assert.deepEqual(
    decideGateRequest(disabled, { url: "http://localhost/files", method: "GET" }),
    { action: "allow", authStatus: "disabled" },
  );
});

test("enabled without session rejects API with 401 and redirects pages with next", () => {
  assert.deepEqual(
    decideGateRequest(enabled, { url: "http://localhost/api/sessions", method: "GET" }),
    { action: "json", status: 401, body: { error: "Unauthorized" } },
  );
  assert.deepEqual(
    decideGateRequest(enabled, { url: "http://localhost/files?path=x", method: "GET" }),
    { action: "redirect", location: "/login?next=%2Ffiles%3Fpath%3Dx" },
  );
});

test("enabled with valid session token allows protected requests", () => {
  const token = session.createSessionToken("secret");
  assert.deepEqual(
    decideGateRequest(enabled, {
      url: "http://localhost/api/sessions",
      method: "GET",
      sessionToken: token,
    }),
    { action: "allow", authStatus: "enabled" },
  );
  assert.deepEqual(
    decideGateRequest(enabled, {
      url: "http://localhost/files?path=x",
      method: "GET",
      sessionToken: token,
    }),
    { action: "allow", authStatus: "enabled" },
  );
});

test("unconfigured and error return 503 for APIs and redirect pages to login", () => {
  assert.deepEqual(
    decideGateRequest(unconfigured, { url: "http://localhost/api/sessions", method: "GET" }),
    {
      action: "json",
      status: 503,
      body: { error: "Authentication is not configured", code: "AUTH_NOT_CONFIGURED" },
    },
  );
  assert.deepEqual(
    decideGateRequest(broken, { url: "http://localhost/", method: "GET" }),
    { action: "redirect", location: "/login" },
  );
  assert.deepEqual(
    decideGateRequest(unconfigured, { url: "http://localhost/files", method: "GET" }),
    { action: "redirect", location: "/login" },
  );
  assert.deepEqual(
    decideGateRequest(broken, { url: "http://localhost/api/sessions", method: "GET" }),
    {
      action: "json",
      status: 503,
      body: { error: "Authentication configuration error", code: "AUTH_CONFIG_ERROR" },
    },
  );
});

test("public gate routes are always allowed so login can recover", () => {
  for (const config of [enabled, disabled, unconfigured, broken]) {
    for (const path of ["/login", "/api/gate/status", "/api/gate/login", "/api/gate/logout"]) {
      const decision = decideGateRequest(config, {
        url: `http://localhost${path}`,
        method: "GET",
      });
      assert.equal(decision.action, "allow");
      assert.equal(decision.authStatus, config.status === "disabled" ? "disabled" : "enabled");
    }
  }
});
