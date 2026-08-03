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
  });

  assert.deepEqual(parseSideChatSessionName(name), {
    mainSessionId: "main:session/with spaces",
    status: "active",
  });
  assert.equal(isSideChatSessionName(name), true);
  assert.equal(isSideChatSessionName("ordinary session"), false);
});

test("legacy side-chat names with toolMode suffix still parse", () => {
  const legacy = [
    "__pi_web_side_chat__",
    encodeURIComponent("main-1"),
    "active",
    "readonly",
  ].join(":");

  assert.deepEqual(parseSideChatSessionName(legacy), {
    mainSessionId: "main-1",
    status: "active",
  });
});

test("side-chat metadata keeps the fork anchor while the name controls status", () => {
  const name = formatSideChatSessionName({
    mainSessionId: "main-1",
    status: "inactive",
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
    forkLeafId: "leaf-7",
  });
});

test("side chat exposes built-in tools plus peek_main without extension/MCP tools", () => {
  assert.deepEqual(getSideChatToolSelection(), {
    toolNames: ["read", "bash", "edit", "write", "grep", "find", "ls", "peek_main"],
    includeExtensionTools: false,
  });
});
