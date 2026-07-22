import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { PushService } = await jiti.import("./push-service.ts");

function fixture(outcomes = {}, options = {}) {
  const removed = [];
  const calls = [];
  const started = [];
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
    removeEndpoint: async (endpoint) => {
      if (typeof options.removeEndpoint === "function") {
        return options.removeEndpoint(endpoint, removed);
      }
      removed.push(endpoint);
    },
  };
  const client = {
    setVapidDetails: (...args) => calls.push(["vapid", ...args]),
    sendNotification: (subscription, payload, sendOptions) => {
      calls.push(["send", subscription, JSON.parse(payload), sendOptions]);
      started.push({ endpoint: subscription.endpoint, at: Date.now() });
      const outcome = outcomes[subscription.endpoint];
      if (outcome && typeof outcome === "object" && outcome.mode === "hang") {
        return new Promise(() => {});
      }
      if (outcome && typeof outcome === "object" && outcome.mode === "late-reject") {
        return new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(Object.assign(new Error("late gone"), { statusCode: outcome.statusCode ?? 410 }));
          }, outcome.delayMs ?? 50);
        });
      }
      if (outcome && typeof outcome === "object" && outcome.mode === "delay-resolve") {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ statusCode: 201 }), outcome.delayMs ?? 20);
        });
      }
      if (outcome === "throw") {
        return Promise.reject(new Error("network down"));
      }
      if (typeof outcome === "number") {
        return Promise.reject(Object.assign(new Error("send failed"), { statusCode: outcome }));
      }
      return Promise.resolve({ statusCode: 201 });
    },
  };
  const agent = { marker: "validated-agent" };
  const service = new PushService({
    store,
    client,
    agent,
    sendTimeoutMs: options.sendTimeoutMs,
    readConfig:
      options.readConfig ??
      (() => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" })),
  });
  return { service, calls, removed, agent, store, started };
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

test("hanging device times out as temporary without removing and sibling still sends", async () => {
  const deadlineMs = 40;
  const { service, removed, calls } = fixture(
    {
      "https://push.example/hang": { mode: "hang" },
      "https://push.example/ok": undefined,
    },
    { subscriptions: ["hang", "ok"], sendTimeoutMs: deadlineMs },
  );

  const startedAt = Date.now();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  const elapsed = Date.now() - startedAt;

  assert.equal(summary.attempted, 2);
  assert.equal(summary.sent, 1);
  assert.deepEqual(
    summary.results.map((item) => item.status).sort(),
    ["sent", "temporary"],
  );
  assert.deepEqual(removed, []);
  assert.ok(elapsed < deadlineMs + 150, `expected near deadline, elapsed=${elapsed}`);
  assert.ok(elapsed >= deadlineMs - 5, `expected at least deadline, elapsed=${elapsed}`);

  const sends = calls.filter(([kind]) => kind === "send");
  assert.equal(sends.length, 2);
  for (const [, , , options] of sends) {
    assert.equal(options.TTL, 300);
    assert.equal(options.timeout, 10_000);
    assert.equal("proxy" in options, false);
  }
});

test("late rejection after deadline is consumed and cannot mutate summary or remove", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    const { service, removed } = fixture(
      {
        "https://push.example/late": { mode: "late-reject", delayMs: 80, statusCode: 410 },
      },
      { subscriptions: ["late"], sendTimeoutMs: 20 },
    );

    const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
    assert.equal(summary.attempted, 1);
    assert.equal(summary.sent, 0);
    assert.equal(summary.results[0].status, "temporary");
    assert.deepEqual(removed, []);

    const frozen = structuredClone(summary);
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.deepEqual(summary, frozen);
    assert.deepEqual(removed, []);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("device sends start in true parallel", async () => {
  const { service, started } = fixture(
    {
      "https://push.example/a": { mode: "delay-resolve", delayMs: 30 },
      "https://push.example/b": { mode: "delay-resolve", delayMs: 30 },
      "https://push.example/c": { mode: "delay-resolve", delayMs: 30 },
    },
    { subscriptions: ["a", "b", "c"], sendTimeoutMs: 200 },
  );

  const startedAt = Date.now();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  const elapsed = Date.now() - startedAt;

  assert.equal(summary.sent, 3);
  assert.equal(started.length, 3);
  const times = started.map((item) => item.at);
  assert.ok(Math.max(...times) - Math.min(...times) < 20, `starts not parallel: ${times.join(",")}`);
  assert.ok(elapsed < 100, `expected parallel wait, elapsed=${elapsed}`);
});

test("cleanup failure is isolated and does not fail sibling devices", async () => {
  const { service, removed } = fixture(
    {
      "https://push.example/gone": 410,
      "https://push.example/ok": undefined,
    },
    {
      subscriptions: ["gone", "ok"],
      removeEndpoint: async (endpoint, removedList) => {
        removedList.push(endpoint);
        throw new Error("disk full");
      },
    },
  );

  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  assert.equal(summary.sent, 1);
  assert.deepEqual(removed, ["https://push.example/gone"]);
  assert.deepEqual(summary.results.map((item) => item.status).sort(), ["gone", "sent"]);
});

test("fast rejection clears deadline without delayed side effects", async () => {
  const { service, removed } = fixture(
    {
      "https://push.example/ok": 503,
    },
    { subscriptions: ["ok"], sendTimeoutMs: 200 },
  );

  const startedAt = Date.now();
  const summary = await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  const elapsed = Date.now() - startedAt;

  assert.equal(summary.results[0].status, "temporary");
  assert.deepEqual(removed, []);
  assert.ok(elapsed < 50, `expected immediate settle, elapsed=${elapsed}`);

  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(removed, []);
  assert.equal(summary.results[0].status, "temporary");
});

test("sendTimeoutMs override does not change web-push options", async () => {
  const { service, calls, agent } = fixture(
    {},
    { subscriptions: ["ok"], sendTimeoutMs: 15 },
  );
  await service.send({ version: 1, id: "n", kind: "test" }, "secret");
  const sends = calls.filter(([kind]) => kind === "send");
  assert.equal(sends.length, 1);
  const options = sends[0][3];
  assert.equal(options.TTL, 300);
  assert.equal(options.timeout, 10_000);
  assert.equal(options.agent, agent);
  assert.equal("proxy" in options, false);
});
