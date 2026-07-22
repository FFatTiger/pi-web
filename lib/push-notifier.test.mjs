import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const mod = await jiti.import("./push-notifier.ts");

test("classifies the final assistant and ignores aborted or missing assistants", () => {
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "stop" }]), "success");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "length" }]), "success");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "error" }]), "error");
  assert.equal(mod.classifySettledMessages([{ role: "assistant", stopReason: "aborted" }]), null);
  assert.equal(mod.classifySettledMessages([{ role: "user", content: "x" }]), null);
  assert.equal(mod.classifySettledMessages([
    { role: "assistant", stopReason: "error" }, { role: "assistant", stopReason: "stop" },
  ]), "success");
});

test("authenticated foreground ACK suppresses Push", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
    getFingerprint: async () => "fp",
    presence: { deliver: async (...args) => { calls.push(["toast", ...args]); return true; } },
    service: { send: async (...args) => calls.push(["push", ...args]) },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] });
  assert.equal(calls.filter(([kind]) => kind === "toast").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "push").length, 0);
});

test("hidden or unacked foreground falls back to Push without throwing into Agent flow", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
    getFingerprint: async () => "fp",
    presence: { deliver: async () => false },
    service: { send: async (...args) => { calls.push(args); throw new Error("provider down"); } },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "error" }] });
  assert.deepEqual(calls[0][0], { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "error" });
  assert.equal(calls[0][1], "secret");
});

test("presence throw falls back to Push", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
    getFingerprint: async () => "fp",
    presence: { deliver: async () => { throw new Error("presence broken"); } },
    service: { send: async (...args) => { calls.push(args); } },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" });
});

test("disabled gate, aborted, and missing assistant produce neither toast nor Push", async () => {
  for (const fixture of [
    {
      name: "disabled gate",
      gate: { status: "disabled", configPath: "/tmp/pi-web.json" },
      messages: [{ role: "assistant", stopReason: "stop" }],
    },
    {
      name: "unconfigured gate",
      gate: { status: "unconfigured", configPath: "/tmp/pi-web.json" },
      messages: [{ role: "assistant", stopReason: "stop" }],
    },
    {
      name: "error gate",
      gate: { status: "error", configPath: "/tmp/pi-web.json", logMessage: "bad" },
      messages: [{ role: "assistant", stopReason: "stop" }],
    },
    {
      name: "aborted",
      gate: { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" },
      messages: [{ role: "assistant", stopReason: "aborted" }],
    },
    {
      name: "no assistant",
      gate: { status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" },
      messages: [{ role: "user", content: "hi" }],
    },
  ]) {
    const calls = [];
    const notifier = new mod.PushNotifier({
      readGateConfig: () => fixture.gate,
      readPushConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", subject: "mailto:owner@example.com" }),
      getFingerprint: async () => "fp",
      presence: { deliver: async (...args) => { calls.push(["toast", ...args]); return false; } },
      service: { send: async (...args) => { calls.push(["push", ...args]); } },
      createId: () => "n1",
      logError: () => {},
    });
    await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: fixture.messages });
    assert.equal(calls.length, 0, fixture.name);
  }
});

test("push-config-disabled does not call presence or service", async () => {
  const calls = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({ status: "disabled", configPath: "/tmp/pi-web.json" }),
    getFingerprint: async () => {
      calls.push(["fingerprint"]);
      return "fp";
    },
    presence: { deliver: async (...args) => { calls.push(["toast", ...args]); return false; } },
    service: { send: async (...args) => { calls.push(["push", ...args]); } },
    createId: () => "n1",
    logError: () => {},
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] });
  assert.deepEqual(calls, []);
});

test("push-config error logs and does not call presence or service", async () => {
  const calls = [];
  const logs = [];
  const notifier = new mod.PushNotifier({
    readGateConfig: () => ({ status: "enabled", configPath: "/tmp/pi-web.json", password: "secret" }),
    readPushConfig: () => ({
      status: "error",
      configPath: "/tmp/pi-web.json",
      code: "PUSH_CONFIG_ERROR",
      logMessage: "push misconfigured",
    }),
    getFingerprint: async () => {
      calls.push(["fingerprint"]);
      return "fp";
    },
    presence: { deliver: async (...args) => { calls.push(["toast", ...args]); return false; } },
    service: { send: async (...args) => { calls.push(["push", ...args]); } },
    createId: () => "n1",
    logError: (message) => { logs.push(message); },
  });
  await notifier.handleSettled({ sessionId: "s1", cycleId: 1, messages: [{ role: "assistant", stopReason: "stop" }] });
  assert.deepEqual(calls, []);
  assert.ok(logs.some((line) => line.includes("push misconfigured")));
});
