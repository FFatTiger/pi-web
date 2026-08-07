import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  createPromptRecoverySnapshot,
  removeOptimisticPrompt,
  shouldRestoreFailedPrompt,
  userMessageKey,
} = await createJiti(import.meta.url).import("./prompt-recovery.ts");

function textMessage(content) {
  return { role: "user", content, timestamp: 1 };
}

test("restores a failed prompt only when the new user message was not persisted", () => {
  const historical = textMessage("repeat this");
  const submitted = textMessage("repeat this");
  const snapshot = createPromptRecoverySnapshot(7, submitted, [historical]);

  assert.equal(shouldRestoreFailedPrompt(snapshot, [historical]), true);
  assert.equal(shouldRestoreFailedPrompt(snapshot, [historical, submitted]), false);
  assert.deepEqual(removeOptimisticPrompt([historical, submitted], snapshot), [historical]);
});

test("tracks attached images when deciding whether a failed prompt survived", () => {
  const submitted = {
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
    timestamp: 1,
  };
  const differentImage = {
    ...submitted,
    content: [
      { type: "text", text: "inspect" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "BAUG" } },
    ],
  };
  const snapshot = createPromptRecoverySnapshot(8, submitted, []);

  assert.notEqual(userMessageKey(submitted), userMessageKey(differentImage));
  assert.equal(shouldRestoreFailedPrompt(snapshot, [differentImage]), true);
  assert.equal(shouldRestoreFailedPrompt(snapshot, [submitted]), false);
});
