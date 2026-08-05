import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SIDE_CHAT_METADATA_TYPE,
  SIDE_CHAT_TTL_MS,
  formatSideChatSessionName,
  getSideChatToolSelection,
  isSideChatExpired,
  isSideChatSessionName,
  parseSideChatSessionName,
  readSideChatSessionMetadata,
  tabIdForSideChat,
  parseSideChatTabId,
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

test("side-chat metadata keeps fork anchor, tool mode, and ephemeral timestamps", () => {
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
      toolMode: "edit",
      forkLeafId: "leaf-7",
      ephemeral: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:30:00.000Z",
      title: "hello",
    },
  }]);

  assert.equal(metadata.mainSessionId, "main-1");
  assert.equal(metadata.status, "inactive");
  assert.equal(metadata.forkLeafId, "leaf-7");
  assert.equal(metadata.toolMode, "edit");
  assert.equal(metadata.ephemeral, true);
  assert.equal(metadata.title, "hello");
});

test("read-only is the default tool selection; edit unlocks write/edit", () => {
  assert.deepEqual(getSideChatToolSelection("readonly"), {
    toolNames: ["read", "bash", "grep", "find", "ls", "peek_main"],
    includeExtensionTools: false,
  });
  assert.deepEqual(getSideChatToolSelection("edit"), {
    toolNames: ["read", "bash", "edit", "write", "grep", "find", "ls", "peek_main"],
    includeExtensionTools: false,
  });
});

test("ephemeral side chats expire after the Codex-style TTL", () => {
  const now = Date.parse("2026-01-01T02:00:00.000Z");
  assert.equal(isSideChatExpired({
    ephemeral: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-01T00:30:00.000Z",
  }, now, SIDE_CHAT_TTL_MS), true);
  assert.equal(isSideChatExpired({
    ephemeral: true,
    createdAt: "2026-01-01T01:30:00.000Z",
    lastActiveAt: "2026-01-01T01:30:00.000Z",
  }, now, SIDE_CHAT_TTL_MS), false);
  assert.equal(isSideChatExpired({
    ephemeral: false,
    createdAt: "2020-01-01T00:00:00.000Z",
    lastActiveAt: "2020-01-01T00:00:00.000Z",
  }, now, SIDE_CHAT_TTL_MS), false);
});

test("side chat tab ids are sidechat:{sessionId}", () => {
  assert.equal(tabIdForSideChat("abc"), "sidechat:abc");
  assert.equal(parseSideChatTabId("sidechat:abc"), "abc");
  assert.equal(parseSideChatTabId("rp:sideChat"), null);
});
