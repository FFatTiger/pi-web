import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SIDE_CHAT_METADATA_TYPE,
  formatSideChatSessionName,
  getSideChatToolSelection,
  isSideChatSessionName,
  parseSideChatSessionName,
  readSideChatSessionMetadata,
} = await jiti.import("./side-chat-metadata.ts");

test("side-chat session markers round-trip without exposing normal sessions", () => {
  const name = formatSideChatSessionName({
    mainSessionId: "main:session/with spaces",
    status: "active",
    toolMode: "readonly",
  });

  assert.deepEqual(parseSideChatSessionName(name), {
    mainSessionId: "main:session/with spaces",
    status: "active",
    toolMode: "readonly",
  });
  assert.equal(isSideChatSessionName(name), true);
  assert.equal(isSideChatSessionName("ordinary session"), false);
});

test("side-chat metadata keeps the fork anchor while the name controls current mode and status", () => {
  const name = formatSideChatSessionName({
    mainSessionId: "main-1",
    status: "inactive",
    toolMode: "edit",
  });
  const metadata = readSideChatSessionMetadata(name, [{
    type: "custom",
    customType: SIDE_CHAT_METADATA_TYPE,
    data: {
      mainSessionId: "main-1",
      status: "active",
      toolMode: "readonly",
      forkLeafId: "leaf-7",
    },
  }]);

  assert.deepEqual(metadata, {
    mainSessionId: "main-1",
    status: "inactive",
    toolMode: "edit",
    forkLeafId: "leaf-7",
  });
});

test("side chat always exposes the full default tool set plus peek_main", () => {
  assert.deepEqual(getSideChatToolSelection("readonly"), {
    toolNames: ["read", "bash", "edit", "write", "grep", "find", "ls", "peek_main"],
    includeExtensionTools: true,
  });
  assert.deepEqual(getSideChatToolSelection("edit"), getSideChatToolSelection("readonly"));
});
