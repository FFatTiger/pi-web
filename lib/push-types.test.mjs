import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const push = await jiti.import("./push-types.ts");

test("accepts only the two version 1 discriminated payload branches", () => {
  assert.deepEqual(push.parseNotificationPayload({
    version: 1, id: "n1", kind: "agent", sessionId: "s/a", result: "success",
  }), { version: 1, id: "n1", kind: "agent", sessionId: "s/a", result: "success" });
  assert.deepEqual(push.parseNotificationPayload({ version: 1, id: "n2", kind: "test" }), {
    version: 1, id: "n2", kind: "test",
  });
  for (const invalid of [
    null,
    { version: 2, id: "n", kind: "test" },
    { version: 1, id: "", kind: "test" },
    { version: 1, id: "n", kind: "agent", result: "success" },
    { version: 1, id: "n", kind: "agent", sessionId: "s", result: "aborted" },
    { version: 1, id: "n", kind: "test", url: "https://evil.example" },
    { version: 1, id: "n", kind: "agent", sessionId: "s", result: "success", title: "secret" },
  ]) assert.equal(push.parseNotificationPayload(invalid), null, JSON.stringify(invalid));
});

test("derives fixed copy, tags, and same-origin relative URLs locally", () => {
  assert.deepEqual(push.getNotificationPresentation({
    version: 1, id: "n1", kind: "agent", sessionId: "a/b?c", result: "error",
  }), {
    title: "Pi Agent Web",
    body: "Agent run failed",
    tag: "pi-web-agent-a%2Fb%3Fc-error",
    url: "/?session=a%2Fb%3Fc",
  });
  assert.deepEqual(push.getNotificationPresentation({ version: 1, id: "n2", kind: "test" }), {
    title: "Pi Agent Web",
    body: "Test notification delivered",
    tag: "pi-web-test",
    url: "/",
  });
});
