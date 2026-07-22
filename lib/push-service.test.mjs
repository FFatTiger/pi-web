import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { PushService } = await jiti.import("./push-service.ts");

function fixture(outcomes = {}, options = {}) {
  const removed = [];
  const calls = [];
  const validP256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
  const validAuth = Buffer.alloc(16, 2).toString("base64url");
  const subscriptions = (options.subscriptions ?? ["ok", "gone", "busy"]).map((id) => ({
    endpoint: `https://push.example/${id}`,
    p256dh: options.invalidKeys ? "not-valid" : validP256dh,
    auth: options.invalidKeys ? "bad" : validAuth,
    createdAt: "x",
    authFingerprint: "fp",
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
      if (outcome === "throw") throw new Error("network down");
      if (outcome) throw Object.assign(new Error("send failed"), { statusCode: outcome });
      return { statusCode: 201 };
    },
  };
  const agent = { marker: "validated-agent" };
  const service = new PushService({
    store,
    client,
    agent,
    readConfig:
      options.readConfig ??
      (() => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" })),
  });
  return { service, calls, removed, agent, store };
}

test("passes fixed timeout, TTL, custom agent, and no proxy", async () => {
  const { service, calls, agent } = fixture();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(summary.attempted, 3);
  assert.equal(summary.sent, 3);
  const vapid = calls.filter(([kind]) => kind === "vapid");
  assert.equal(vapid.length, 1);
  assert.deepEqual(vapid[0], ["vapid", "mailto:owner@example.com", "public", "private"]);
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

test("classifies auth, temporary, invalid_target, and ordinary errors without deleting", async () => {
  const cases = [
    { outcomes: { "https://push.example/ok": 401 }, status: "auth_error" },
    { outcomes: { "https://push.example/ok": 403 }, status: "auth_error" },
    { outcomes: { "https://push.example/ok": 429 }, status: "temporary" },
    { outcomes: { "https://push.example/ok": 500 }, status: "temporary" },
    { outcomes: { "https://push.example/ok": "throw" }, status: "error" },
  ];
  for (const item of cases) {
    const { service, removed } = fixture(item.outcomes, { subscriptions: ["ok"] });
    const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
    assert.equal(summary.attempted, 1);
    assert.equal(summary.sent, 0);
    assert.equal(summary.results[0].status, item.status);
    assert.deepEqual(removed, []);
  }

  const invalid = fixture({}, { subscriptions: ["ok"], invalidKeys: true });
  const invalidSummary = await invalid.service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(invalidSummary.attempted, 1);
  assert.equal(invalidSummary.sent, 0);
  assert.equal(invalidSummary.results[0].status, "invalid_target");
  assert.deepEqual(invalid.removed, []);
});

test("deletes only 404 endpoints and keeps other devices intact", async () => {
  const { service, removed } = fixture({
    "https://push.example/gone": 404,
  });
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(summary.sent, 2);
  assert.deepEqual(removed, ["https://push.example/gone"]);
  assert.ok(summary.results.some((item) => item.status === "gone"));
});

test("disabled config returns empty summary; error config throws safe code", async () => {
  const disabled = fixture({}, {
    readConfig: () => ({ status: "disabled", configPath: "/tmp/pi-web.json" }),
  });
  assert.deepEqual(await disabled.service.send({ version: 1, id: "n", kind: "test" }, "secret"), {
    attempted: 0,
    sent: 0,
    results: [],
  });
  assert.equal(disabled.calls.length, 0);

  const errored = fixture({}, {
    readConfig: () => ({
      status: "error",
      configPath: "/tmp/pi-web.json",
      code: "PUSH_CONFIG_ERROR",
      logMessage: "secret subject details",
    }),
  });
  await assert.rejects(
    () => errored.service.send({ version: 1, id: "n", kind: "test" }, "secret"),
    (error) => error && error.code === "PUSH_CONFIG_ERROR",
  );
});

test("unknown optional endpoint attempts zero sends", async () => {
  const { service, calls } = fixture();
  const summary = await service.send(
    { version: 1, id: "n", kind: "test" },
    "secret",
    "https://push.example/missing",
  );
  assert.equal(summary.attempted, 0);
  assert.equal(summary.sent, 0);
  assert.equal(calls.filter(([kind]) => kind === "send").length, 0);
});
