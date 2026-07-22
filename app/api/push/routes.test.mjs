import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const statusRoute = await jiti.import("./status/route.ts");
const keyRoute = await jiti.import("./vapid-public-key/route.ts");
const subscribeRoute = await jiti.import("./subscribe/route.ts");
const testRoute = await jiti.import("./test/route.ts");
const pushHandlers = await jiti.import("../../../lib/push-route-handlers.ts");

const routeContracts = [
  ["status/route.ts", ["GET", "dynamic", "runtime"]],
  ["vapid-public-key/route.ts", ["GET", "dynamic", "runtime"]],
  ["subscribe/route.ts", ["DELETE", "POST", "dynamic", "runtime"]],
  ["test/route.ts", ["POST", "dynamic", "runtime"]],
];

test("Push routes expose only Next-supported runtime exports", () => {
  for (const [path, expected] of routeContracts) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const names = [
      ...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g),
      ...source.matchAll(/export\s+const\s+(\w+)/g),
    ].map((match) => match[1]).sort();
    assert.deepEqual(names, expected, path);
  }
});

const enabled = { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" };
const disabledGate = { status: "disabled", configPath: "/tmp/pi-web.json" };
const pushEnabled = {
  status: "enabled",
  configPath: "/tmp/pi-web.json",
  subject: "mailto:owner@example.com",
};
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const auth = Buffer.alloc(16, 2).toString("base64url");

function jsonRequest(path, method, body, headers = {}) {
  return new Request(`https://pi.example${path}`, {
    method,
    headers: {
      origin: "https://pi.example",
      "content-type": "application/json",
      "x-pi-web-auth-status": "enabled",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function bodyOf(response) {
  return response.json();
}

async function assertError(response, status, code) {
  assert.ok(response instanceof Response);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  assert.equal(Object.keys(body).sort().join(","), "code,error");
  assert.doesNotMatch(JSON.stringify(body), /secret|private|p256dh|authFingerprint|configPath|endpoint path|provider detail/i);
}

test("status returns safe no-store capability without exposing keys", async () => {
  const handler = pushHandlers.createStatusHandler({
    readGateConfig: () => enabled,
    readPushConfig: () => pushEnabled,
    store: { getPublicKey: async () => "public-key" },
  });
  const response = await handler(new Request("https://pi.example/api/push/status", {
    headers: { "x-pi-web-auth-status": "enabled" },
  }));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await bodyOf(response);
  assert.deepEqual(body, {
    supported: true,
    gateEnabled: true,
    configured: true,
    publicKeyAvailable: true,
  });
  assert.doesNotMatch(JSON.stringify(body), /public-key|private|secret/i);
});

test("status exposes only disabled diagnostics and safely maps config/store failures", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    let keyCalls = 0;
    const disabled = pushHandlers.createStatusHandler({
      readGateConfig: () => disabledGate,
      readPushConfig: () => pushEnabled,
      store: { getPublicKey: async () => { keyCalls += 1; return "key"; } },
    });
    const disabledResponse = await disabled(new Request("https://pi.example/api/push/status"));
    assert.deepEqual(await disabledResponse.json(), {
      supported: true,
      gateEnabled: false,
      configured: false,
      publicKeyAvailable: false,
      code: "PUSH_GATE_REQUIRED",
    });
    assert.equal(keyCalls, 0);

    const unauthorized = pushHandlers.createStatusHandler({
      readGateConfig: () => enabled,
      readPushConfig: () => pushEnabled,
      store: { getPublicKey: async () => "key" },
    });
    await assertError(
      await unauthorized(new Request("https://pi.example/api/push/status")),
      401,
      "PUSH_UNAUTHORIZED",
    );

    const configError = pushHandlers.createStatusHandler({
      readGateConfig: () => enabled,
      readPushConfig: () => ({
        status: "error",
        configPath: "/secret/path",
        code: "PUSH_CONFIG_ERROR",
        logMessage: "secret config detail",
      }),
      store: { getPublicKey: async () => "key" },
    });
    const configResponse = await configError(new Request("https://pi.example/api/push/status", {
      headers: { "x-pi-web-auth-status": "enabled" },
    }));
    assert.deepEqual(await configResponse.json(), {
      supported: true,
      gateEnabled: true,
      configured: false,
      publicKeyAvailable: false,
      code: "PUSH_CONFIG_ERROR",
    });

    const locked = pushHandlers.createStatusHandler({
      readGateConfig: () => enabled,
      readPushConfig: () => pushEnabled,
      store: { getPublicKey: async () => { throw Object.assign(new Error("secret disk"), { code: "PUSH_STORE_LOCKED" }); } },
    });
    const lockedResponse = await locked(new Request("https://pi.example/api/push/status", {
      headers: { "x-pi-web-auth-status": "enabled" },
    }));
    assert.deepEqual(await lockedResponse.json(), {
      supported: true,
      gateEnabled: true,
      configured: true,
      publicKeyAvailable: false,
      code: "PUSH_STORE_LOCKED",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("public key requires enabled authenticated gate and enabled Push config", async () => {
  const getKey = pushHandlers.createPublicKeyHandler({
    readGateConfig: () => enabled,
    readPushConfig: () => pushEnabled,
    store: { getPublicKey: async () => "public-key" },
  });
  await assertError(
    await getKey(new Request("https://pi.example/api/push/vapid-public-key")),
    401,
    "PUSH_UNAUTHORIZED",
  );
  const authorized = await getKey(new Request("https://pi.example/api/push/vapid-public-key", {
    headers: { "x-pi-web-auth-status": "enabled" },
  }));
  assert.deepEqual(await authorized.json(), { publicKey: "public-key" });
  assert.equal(authorized.headers.get("cache-control"), "no-store");

  const disabledPush = pushHandlers.createPublicKeyHandler({
    readGateConfig: () => enabled,
    readPushConfig: () => ({ status: "disabled", configPath: "/tmp/pi-web.json" }),
    store: { getPublicKey: async () => "never" },
  });
  await assertError(
    await disabledPush(new Request("https://pi.example/api/push/vapid-public-key", {
      headers: { "x-pi-web-auth-status": "enabled" },
    })),
    503,
    "PUSH_CONFIG_ERROR",
  );
});

test("subscribe validates then creates, updates, and reports the twenty-device limit", async () => {
  const seen = [];
  let result = "created";
  const handlers = pushHandlers.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: {
      upsert: async (value, password) => { seen.push([value, password]); return result; },
      remove: async () => true,
    },
  });
  const body = { endpoint: "https://push.example/a", keys: { p256dh, auth } };
  let response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "created" });
  assert.deepEqual(seen[0], [{ endpoint: body.endpoint, p256dh, auth }, "secret"]);

  result = "updated";
  response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  assert.deepEqual(await response.json(), { ok: true, status: "updated" });

  result = "limit";
  response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", body));
  await assertError(response, 409, "PUSH_SUBSCRIPTION_LIMIT");

  response = await handlers.POST(jsonRequest("/api/push/subscribe", "POST", {
    endpoint: "https://127.0.0.1/a",
    keys: { p256dh, auth },
  }));
  await assertError(response, 400, "PUSH_INVALID_SUBSCRIPTION");
});

test("unsubscribe deletes only the current fingerprint endpoint", async () => {
  const calls = [];
  const handlers = pushHandlers.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: {
      upsert: async () => "created",
      remove: async (...args) => { calls.push(args); return true; },
    },
  });
  const response = await handlers.DELETE(jsonRequest(
    "/api/push/subscribe",
    "DELETE",
    { endpoint: "https://push.example/a" },
  ));
  assert.deepEqual(await response.json(), { ok: true, removed: true });
  assert.deepEqual(calls, [["https://push.example/a", "secret"]]);

  for (const invalid of [
    {},
    { endpoint: "" },
    { endpoint: "http://push.example/a" },
    { endpoint: "https://user@push.example/a" },
    { endpoint: "https://push.example/a", extra: true },
  ]) {
    await assertError(
      await handlers.DELETE(jsonRequest("/api/push/subscribe", "DELETE", invalid)),
      400,
      "PUSH_INVALID_SUBSCRIPTION",
    );
  }
});

test("test route sends only its fixed payload to the submitted authorized endpoint", async () => {
  const calls = [];
  const handler = pushHandlers.createTestHandler({
    readGateConfig: () => enabled,
    service: {
      send: async (...args) => {
        calls.push(args);
        return { attempted: 1, sent: 1, results: [] };
      },
    },
    createId: () => "notification-id",
  });
  const response = await handler(jsonRequest(
    "/api/push/test",
    "POST",
    { endpoint: "https://push.example/a" },
  ));
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.deepEqual(calls, [[
    { version: 1, id: "notification-id", kind: "test" },
    "secret",
    "https://push.example/a",
  ]]);

  const missing = pushHandlers.createTestHandler({
    readGateConfig: () => enabled,
    service: { send: async () => ({ attempted: 0, sent: 0, results: [] }) },
    createId: () => "id",
  });
  await assertError(
    await missing(jsonRequest("/api/push/test", "POST", { endpoint: "https://push.example/a" })),
    404,
    "PUSH_SUBSCRIPTION_NOT_FOUND",
  );

  const failed = pushHandlers.createTestHandler({
    readGateConfig: () => enabled,
    service: { send: async () => ({ attempted: 1, sent: 0, results: [{ endpointHost: "secret.example", status: "error" }] }) },
    createId: () => "id",
  });
  await assertError(
    await failed(jsonRequest("/api/push/test", "POST", { endpoint: "https://push.example/a" })),
    502,
    "PUSH_TEST_FAILED",
  );
});

test("mutating handlers share origin, JSON, malformed-body, size, auth, and store-lock boundaries", async () => {
  const subscribe = pushHandlers.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: { upsert: async () => "created", remove: async () => true },
  });
  const testHandler = pushHandlers.createTestHandler({
    readGateConfig: () => enabled,
    service: { send: async () => ({ attempted: 1, sent: 1, results: [] }) },
    createId: () => "id",
  });
  const calls = [
    (req) => subscribe.POST(req),
    (req) => subscribe.DELETE(req),
    (req) => testHandler(req),
  ];

  for (const call of calls) {
    await assertError(
      await call(jsonRequest("/api/push/test", "POST", {}, { origin: "https://evil.example" })),
      403,
      "PUSH_ORIGIN_MISMATCH",
    );
    await assertError(
      await call(jsonRequest("/api/push/test", "POST", {}, { "content-type": "text/plain" })),
      415,
      "PUSH_JSON_REQUIRED",
    );
    await assertError(
      await call(jsonRequest("/api/push/test", "POST", "{broken")),
      400,
      "PUSH_INVALID_BODY",
    );
    await assertError(
      await call(jsonRequest("/api/push/test", "POST", { value: "x".repeat(17 * 1024) })),
      413,
      "PUSH_BODY_TOO_LARGE",
    );
  }

  const unauthorized = pushHandlers.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: { upsert: async () => "created", remove: async () => true },
  });
  const req = jsonRequest("/api/push/subscribe", "POST", {
    endpoint: "https://push.example/a",
    keys: { p256dh, auth },
  }, { "x-pi-web-auth-status": "disabled" });
  await assertError(await unauthorized.POST(req), 401, "PUSH_UNAUTHORIZED");

  const locked = pushHandlers.createSubscribeHandlers({
    readGateConfig: () => enabled,
    store: {
      upsert: async () => { throw Object.assign(new Error("secret file"), { code: "PUSH_STORE_LOCKED" }); },
      remove: async () => false,
    },
  });
  await assertError(
    await locked.POST(jsonRequest("/api/push/subscribe", "POST", {
      endpoint: "https://push.example/a",
      keys: { p256dh, auth },
    })),
    503,
    "PUSH_STORE_LOCKED",
  );
});
