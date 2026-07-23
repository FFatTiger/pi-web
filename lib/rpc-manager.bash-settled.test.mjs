import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": packageRoot } });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function fakeSession(overrides = {}) {
  const state = {
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    executeCalls: 0,
    promptCalls: 0,
    abortBashCalls: 0,
  };

  let listener;
  const session = {
    sessionId: "s-bash",
    sessionFile: "/tmp/s-bash.jsonl",
    get isStreaming() { return state.isStreaming; },
    get isCompacting() { return state.isCompacting; },
    get isBashRunning() { return state.isBashRunning; },
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: {
      isPersisted: () => true,
      getSessionDir: () => "/tmp",
      getCwd: () => "/tmp",
      getEntry: () => null,
      // Already-flushed session: persistBashOnlySession short-circuits.
      getSessionFile: () => "/tmp/s-bash.jsonl",
      getHeader: () => null,
      getEntries: () => [],
    },
    settingsManager: {},
    agent: { state: {} },
    extensionRunner: {},
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    pendingMessageCount: 0,
    subscribe(fn) {
      listener = fn;
      return () => {};
    },
    emit(event) {
      listener?.(event);
    },
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    getContextUsage: () => undefined,
    async prompt() {
      state.promptCalls += 1;
      return undefined;
    },
    executeBash() {
      state.executeCalls += 1;
      state.isBashRunning = true;
      return Promise.resolve({
        output: "",
        exitCode: 0,
        truncated: false,
        fullOutputPath: null,
      }).finally(() => {
        state.isBashRunning = false;
      });
    },
    abortBash() {
      state.abortBashCalls += 1;
      state.isBashRunning = false;
    },
    ...overrides,
  };

  return { session, state };
}

function withDeferredBash() {
  let resolveBash;
  const { session, state } = fakeSession({
    executeBash() {
      state.executeCalls += 1;
      state.isBashRunning = true;
      return new Promise((resolve) => {
        resolveBash = (value) => {
          state.isBashRunning = false;
          resolve(value ?? {
            output: "",
            exitCode: 0,
            truncated: false,
            fullOutputPath: null,
          });
        };
      });
    },
  });
  return {
    session,
    state,
    resolveBash: (value) => resolveBash?.(value),
  };
}

test("bash-only runs never invoke settledNotifier", async () => {
  const { session: inner, state, resolveBash } = withDeferredBash();
  const snapshots = [];
  const wrapper = new AgentSessionWrapper(inner, {
    settledNotifier: async (snapshot) => snapshots.push(snapshot),
  });
  wrapper.start();

  const bashPromise = wrapper.send({ type: "bash", command: "pwd" });
  assert.equal(state.isBashRunning, true);
  assert.equal(state.executeCalls, 1);

  // Shell traffic must not open an agent notification cycle.
  inner.emit({ type: "message_end", message: { role: "bashExecution", command: "pwd" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, []);

  resolveBash({ output: "/tmp\n", exitCode: 0, truncated: false, fullOutputPath: null });
  await bashPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, []);
  wrapper.destroy();
});

test("prompt is rejected while bash is running", async () => {
  const { session: inner, state, resolveBash } = withDeferredBash();
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  const bashPromise = wrapper.send({ type: "bash", command: "sleep 1" });
  await assert.rejects(
    () => wrapper.send({ type: "prompt", message: "hello" }),
    /Cannot send a prompt while a shell command is running/,
  );
  assert.equal(state.promptCalls, 0);
  resolveBash();
  await bashPromise;
  wrapper.destroy();
});

test("bash is rejected while a prompt is running", async () => {
  let resolvePrompt;
  const { session: inner, state } = fakeSession({
    async prompt() {
      state.promptCalls += 1;
      return new Promise((resolve) => {
        resolvePrompt = resolve;
      });
    },
  });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  // prompt is fire-and-forget and resolves the RPC command immediately.
  await wrapper.send({ type: "prompt", message: "hello" });
  assert.equal(state.promptCalls, 1);
  await assert.rejects(
    () => wrapper.send({ type: "bash", command: "ls" }),
    /Cannot run a shell command while the session is busy/,
  );
  assert.equal(state.executeCalls, 0);
  resolvePrompt();
  await new Promise((resolve) => setTimeout(resolve, 0));
  wrapper.destroy();
});

test("fork and navigate_tree are rejected while bash is running", async () => {
  const { session: inner, resolveBash } = withDeferredBash();
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  const bashPromise = wrapper.send({ type: "bash", command: "sleep 1" });
  await assert.rejects(
    () => wrapper.send({ type: "fork", entryId: "x" }),
    /Cannot fork while a shell command is running/,
  );
  await assert.rejects(
    () => wrapper.send({ type: "navigate_tree", targetId: "x" }),
    /Cannot navigate while a shell command is running/,
  );
  resolveBash();
  await bashPromise;
  wrapper.destroy();
});

test("agent cycle still notifies after prior bash run", async () => {
  const { session: inner, resolveBash } = withDeferredBash();
  const snapshots = [];
  const wrapper = new AgentSessionWrapper(inner, {
    settledNotifier: async (snapshot) => snapshots.push(snapshot),
  });
  wrapper.start();

  const bashPromise = wrapper.send({ type: "bash", command: "echo 1" });
  resolveBash({ output: "1\n", exitCode: 0, truncated: false, fullOutputPath: null });
  await bashPromise;
  assert.deepEqual(snapshots, []);

  inner.emit({ type: "agent_start" });
  inner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });
  inner.emit({ type: "agent_settled" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(snapshots, [{
    sessionId: "s-bash",
    cycleId: 1,
    messages: [{ role: "assistant", stopReason: "stop" }],
  }]);
  wrapper.destroy();
});
