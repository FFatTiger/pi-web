import assert from "node:assert/strict";
import test from "node:test";
import { createHostApp } from "../dist/index.js";

const DISABLED_GATE = { read: () => ({ status: "disabled", source: "test" }) };

function appWith(extra = {}) {
  return createHostApp({
    logger: {},
    gate: { config: DISABLED_GATE },
    ...extra,
  }).app;
}

test("health reports sessiond up with full capabilities", async () => {
  const app = appWith({ sessiond: { isAvailable: async () => true } });
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "pi-web-host");
  assert.equal(body.sessiond, "up");
  assert.deepEqual(body.capabilities, ["agent", "files", "files.write", "git", "worktree"]);
});

test("health reports sessiond down with read-only capabilities", async () => {
  const app = appWith({ sessiond: { isAvailable: async () => false } });
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.equal(body.sessiond, "down");
  assert.deepEqual(body.capabilities, ["files"]);
});

test("no sessiond probe wired → unknown + read-only capabilities (safe default)", async () => {
  const app = appWith({});
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.equal(body.sessiond, "unknown");
  assert.deepEqual(body.capabilities, ["files"]);
});

test("capabilities endpoint mirrors health projection", async () => {
  const app = appWith({ sessiond: { isAvailable: async () => false } });
  const res = await app.request("http://localhost/v1/capabilities", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.deepEqual(body, {
    ok: true,
    sessiond: "down",
    capabilities: ["files"],
  });
});

test("custom capability sets are respected", async () => {
  const app = appWith({
    sessiond: { isAvailable: async () => true },
    capabilities: { full: ["agent", "git"], readonly: ["files"] },
  });
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.deepEqual(body.capabilities, ["agent", "git"]);
});

test("probe errors degrade to read-only", async () => {
  const app = appWith({
    sessiond: { isAvailable: async () => { throw new Error("boom"); } },
  });
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.equal(body.sessiond, "down");
  assert.deepEqual(body.capabilities, ["files"]);
});

test("probe timeout degrades to read-only", async () => {
  const app = appWith({
    sessiondProbeTimeoutMs: 20,
    sessiond: { isAvailable: () => new Promise(() => {}) },
  });
  const started = Date.now();
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const body = await res.json();
  assert.equal(body.sessiond, "down");
  assert.deepEqual(body.capabilities, ["files"]);
  assert.ok(Date.now() - started < 500, "probe timeout must bound request latency");
});

test("request id header is echoed on responses", async () => {
  const app = appWith({ sessiond: { isAvailable: async () => true } });
  const res = await app.request("http://localhost/v1/health", { headers: { host: "localhost" } });
  const requestId = res.headers.get("x-request-id");
  assert.ok(requestId && requestId.length >= 16, "x-request-id must be present");
});
