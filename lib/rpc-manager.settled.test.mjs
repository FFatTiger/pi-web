import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function fakeSession() {
  let listener;
  return {
    sessionId: "s1", sessionFile: "/tmp/s1.jsonl", isStreaming: false, isCompacting: false,
    autoCompactionEnabled: true, autoRetryEnabled: true, model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: {}, settingsManager: {}, agent: { state: {} },
    extensionRunner: {}, promptTemplates: [], resourceLoader: { getSkills: () => ({ skills: [] }) },
    pendingMessageCount: 0,
    subscribe(fn) { listener = fn; return () => {}; },
    emit(event) { listener(event); },
    getAllTools: () => [], getActiveToolNames: () => [], getSteeringMessages: () => [], getFollowUpMessages: () => [],
    getContextUsage: () => undefined,
  };
}

test("wrapper forwards events while notifying only once after settled", async () => {
  const inner = fakeSession();
  const snapshots = [];
  const forwarded = [];
  const wrapper = new AgentSessionWrapper(inner, { settledNotifier: async (snapshot) => snapshots.push(snapshot) });
  wrapper.onEvent((event) => forwarded.push(event.type));
  wrapper.start();
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }], willRetry: true });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  inner.emit({ type: "agent_settled" });
  inner.emit({ type: "agent_settled" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, [{ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] }]);
  assert.deepEqual(forwarded, ["agent_start", "agent_end", "agent_end", "agent_settled", "agent_settled"]);
  wrapper.destroy();
});

test("rejecting settledNotifier does not break subsequent event forwarding", async () => {
  const inner = fakeSession();
  const forwarded = [];
  let calls = 0;
  const wrapper = new AgentSessionWrapper(inner, {
    settledNotifier: async () => {
      calls += 1;
      throw new Error("notifier boom");
    },
  });
  wrapper.onEvent((event) => forwarded.push(event.type));
  wrapper.start();
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
  inner.emit({ type: "agent_settled" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  // Subsequent independent cycle still forwards events and wrapper stays alive.
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "message_update", message: { role: "assistant", content: [] } });
  assert.deepEqual(forwarded, [
    "agent_start",
    "agent_end",
    "agent_settled",
    "agent_start",
    "message_update",
  ]);
  assert.equal(wrapper.isAlive(), true);
  wrapper.destroy();
});

test("agent_end alone never invokes settledNotifier", async () => {
  const inner = fakeSession();
  const snapshots = [];
  const wrapper = new AgentSessionWrapper(inner, {
    settledNotifier: async (snapshot) => snapshots.push(snapshot),
  });
  wrapper.start();
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, []);
  wrapper.destroy();
});
