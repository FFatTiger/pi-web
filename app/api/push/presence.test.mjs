import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const jiti = createJiti(import.meta.url, { alias: { "@": packageRoot } });
const route = await jiti.import("./presence/route.ts");
const pushHandlers = await jiti.import("../../../lib/push-route-handlers.ts");
const presenceRouteSource = readFileSync(new URL("./presence/route.ts", import.meta.url), "utf8");

test("presence route exposes only Next-supported runtime exports", () => {
  const names = [
    ...presenceRouteSource.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g),
    ...presenceRouteSource.matchAll(/export\s+const\s+(\w+)/g),
  ].map((match) => match[1]).sort();
  assert.deepEqual(names, ["POST", "dynamic", "runtime"]);
});
const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };

test("presence route scopes visibility and ACK to the current fingerprint", async () => {
  const calls = [];
  const handler = pushHandlers.createPresenceHandler({
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

test("presence route returns 404 for unknown connection", async () => {
  const handler = pushHandlers.createPresenceHandler({
    readGateConfig: () => enabled,
    getFingerprint: async () => "fp",
    registry: { has: () => false, update: () => true },
  });
  const response = await handler(new Request("https://pi.example/api/push/presence", {
    method: "POST",
    headers: { origin: "https://pi.example", "content-type": "application/json", "x-pi-web-auth-status": "enabled" },
    body: JSON.stringify({ connectionId: "missing", visibility: "hidden" }),
  }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "PUSH_CONNECTION_NOT_FOUND",
    error: "Push connection was not found",
  });
});

test("presence route rejects extra body keys", async () => {
  const handler = pushHandlers.createPresenceHandler({
    readGateConfig: () => enabled,
    getFingerprint: async () => "fp",
    registry: { has: () => true, update: () => true },
  });
  const response = await handler(new Request("https://pi.example/api/push/presence", {
    method: "POST",
    headers: { origin: "https://pi.example", "content-type": "application/json", "x-pi-web-auth-status": "enabled" },
    body: JSON.stringify({ connectionId: "c1", visibility: "visible", extra: true }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "PUSH_INVALID_BODY");
});
