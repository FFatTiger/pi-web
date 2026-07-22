import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
});
const hook = await jiti.import("./useAppPresence.ts");

test("parses only connected, running, and validated agent notification frames", () => {
  assert.deepEqual(hook.parseRunningEventsMessage({ type: "connected", connectionId: "c1" }), { type: "connected", connectionId: "c1" });
  assert.deepEqual(hook.parseRunningEventsMessage({ type: "running", runningSessionIds: ["s1"] }), { type: "running", runningSessionIds: ["s1"] });
  assert.deepEqual(hook.parseRunningEventsMessage({
    type: "notification", notification: { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" },
  }), {
    type: "notification", notification: { version: 1, id: "n1", kind: "agent", sessionId: "s1", result: "success" },
  });
  assert.equal(hook.parseRunningEventsMessage({ type: "notification", notification: { version: 1, id: "n", kind: "test" } }), null);
  assert.equal(hook.parseRunningEventsMessage({ type: "running", runningSessionIds: [1] }), null);
  assert.equal(hook.parseRunningEventsMessage({ type: "connected", connectionId: "" }), null);
  assert.equal(hook.parseRunningEventsMessage({ type: "connected", connectionId: "x".repeat(129) }), null);
  assert.deepEqual(
    hook.parseRunningEventsMessage({ type: "running", runningSessionIds: ["s1", "s1", "s2"] }),
    { type: "running", runningSessionIds: ["s1", "s2"] },
  );
});
