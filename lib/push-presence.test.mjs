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

test("any valid ACK among multiple candidates resolves once", async () => {
  const { registry } = fixture();
  const sent = [];
  registry.register("c1", "fp", (message) => sent.push(["c1", message]));
  registry.register("c2", "fp", (message) => sent.push(["c2", message]));
  registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: "visible" });
  registry.update({ connectionId: "c2", authFingerprint: "fp", visibility: "visible" });
  const delivered = registry.deliver(payload, "fp");
  assert.equal(sent.length, 2);
  assert.equal(registry.update({
    connectionId: "c2", authFingerprint: "fp", visibility: "visible", ackNotificationId: "n1",
  }), true);
  assert.equal(await delivered, true);
  // Second ACK after resolution remains a successful heartbeat only.
  assert.equal(registry.update({
    connectionId: "c1", authFingerprint: "fp", visibility: "visible", ackNotificationId: "n1",
  }), true);
});

test("fingerprint mismatch and no candidates do not suppress Push", async () => {
  const { registry } = fixture();
  registry.register("c1", "fp-a", () => {});
  registry.update({ connectionId: "c1", authFingerprint: "fp-a", visibility: "visible" });
  assert.equal(await registry.deliver(payload, "fp-b"), false);

  registry.unregister("c1");
  assert.equal(await registry.deliver(payload, "fp-a"), false);
});

test("unknown ACK on existing connection is successful heartbeat", async () => {
  const { registry } = fixture();
  registry.register("c1", "fp", () => {});
  assert.equal(registry.update({
    connectionId: "c1", authFingerprint: "fp", visibility: "visible", ackNotificationId: "unknown",
  }), true);
  assert.equal(registry.has("c1", "fp"), true);
});

test("prune removes stale connections and has rejects them", async () => {
  const { registry, advance } = fixture();
  registry.register("c1", "fp", () => {});
  registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: "visible" });
  assert.equal(registry.has("c1", "fp"), true);
  advance(35_001);
  assert.equal(registry.has("c1", "fp"), false);
  assert.equal(registry.update({
    connectionId: "c1", authFingerprint: "fp", visibility: "visible",
  }), false);
});

test("disconnect removes pending waiter membership and times out false", async () => {
  const { registry, expire } = fixture();
  registry.register("c1", "fp", () => {});
  registry.update({ connectionId: "c1", authFingerprint: "fp", visibility: "visible" });
  const delivered = registry.deliver(payload, "fp");
  registry.unregister("c1");
  expire();
  assert.equal(await delivered, false);
  assert.equal(registry.has("c1", "fp"), false);
});
