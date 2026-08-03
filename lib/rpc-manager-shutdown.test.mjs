import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown still disposes the SDK session when an extension fails", async () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);

  assert.deepEqual(calls, ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction disposes the SDK session before unregistering the wrapper", () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {},
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  wrapper.destroy();
  wrapper.destroy();

  assert.deepEqual(calls, ["dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("Side Chat context stays at the settled leaf while the main agent is running", async () => {
  let leafId = "settled-leaf";
  let subscriber;
  let resolvePrompt;
  const inner = {
    sessionId: "main-session",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: {
      getSessionName: () => undefined,
      getCwd: () => process.cwd(),
      getBranch: () => [],
      getLeafId: () => leafId,
    },
    subscribe(handler) {
      subscriber = handler;
      return () => {};
    },
    prompt() {
      return new Promise((resolve) => { resolvePrompt = resolve; });
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();

  await wrapper.send({ type: "prompt", message: "run main task" });
  leafId = "active-user-leaf";
  assert.equal(wrapper.getSideChatContextLeafId(), "settled-leaf");

  subscriber({ type: "agent_start" });
  leafId = "active-task-leaf";
  inner.isStreaming = true;
  assert.equal(wrapper.getSideChatContextLeafId(), "settled-leaf");

  subscriber({ type: "agent_settled" });
  inner.isStreaming = false;
  assert.equal(wrapper.getSideChatContextLeafId(), "active-task-leaf");
  resolvePrompt();
  await Promise.resolve();
  wrapper.destroy();
});
