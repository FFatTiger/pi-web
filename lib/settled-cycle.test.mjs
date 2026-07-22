import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { SettledCycleTracker } = await jiti.import("./settled-cycle.ts");

test("allocates on first start, overwrites candidates, and consumes exactly once at settled", () => {
  const tracker = new SettledCycleTracker("s1");
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
  assert.equal(tracker.accept({ type: "agent_start" }), null);
  assert.equal(tracker.accept({ type: "agent_start" }), null);
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }], willRetry: true });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  assert.deepEqual(tracker.accept({ type: "agent_settled" }), {
    sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }],
  });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});

test("the next independent start receives a new cycle id", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  tracker.accept({ type: "agent_settled" });
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
  assert.equal(tracker.accept({ type: "agent_settled" }).cycleId, 2);
});

test("settled without a candidate and command errors without agent_start do not notify", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "prompt_error", errorMessage: "bad" });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
  tracker.accept({ type: "agent_start" });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});

test("compaction and intermediate events keep the same active cycle until settled", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }], willRetry: true });
  tracker.accept({ type: "auto_compaction_start" });
  tracker.accept({ type: "auto_compaction_end" });
  tracker.accept({ type: "agent_start" }); // same cycle
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  const snap = tracker.accept({ type: "agent_settled" });
  assert.deepEqual(snap, {
    sessionId: "s1",
    cycleId: 1,
    messages: [{ role: "assistant", stopReason: "stop" }],
  });
});

test("late agent_end after settled does not recreate a cycle without agent_start", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  tracker.accept({ type: "agent_settled" });
  tracker.accept({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});

test("agent_end without messages array does not install a candidate", () => {
  const tracker = new SettledCycleTracker("s1");
  tracker.accept({ type: "agent_start" });
  tracker.accept({ type: "agent_end", willRetry: false });
  assert.equal(tracker.accept({ type: "agent_settled" }), null);
});
