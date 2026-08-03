import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSideChatExtension, summarizeMainActivity } = await jiti.import("./side-chat-extension.ts");
const { normalizeSideChatFilePath } = await jiti.import("./side-chat-file-activity.ts");

function messageEntry(id, parentId, message) {
  return { id, parentId, type: "message", timestamp: "2026-01-01T00:00:00.000Z", message };
}

function managerWithMessages() {
  const entries = [
    messageEntry("u1", null, { role: "user", content: "old request", timestamp: 1 }),
    messageEntry("fork", "u1", {
      role: "assistant",
      content: [{ type: "text", text: "old answer" }],
      timestamp: 2,
    }),
    messageEntry("u2", "fork", { role: "user", content: "new request", timestamp: 3 }),
    messageEntry("a2", "u2", {
      role: "assistant",
      content: [
        { type: "text", text: "new answer" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/main.ts" } },
      ],
      timestamp: 4,
    }),
    messageEntry("t2", "a2", {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      timestamp: 5,
    }),
  ];
  return {
    getEntries: () => entries,
    getLeafId: () => "t2",
  };
}

test("peek_main defaults to the whole current branch and formats tools", () => {
  const summary = summarizeMainActivity(managerWithMessages(), "fork", 20, false);
  assert.match(summary, /\[User\]: old request/);
  assert.match(summary, /\[Assistant\]: old answer/);
  assert.match(summary, /\[Calling: read\]/);
  assert.match(summary, /\[read\]: file contents/);
});

test("peek_main only filters from the fork when since_fork is true", () => {
  const summary = summarizeMainActivity(managerWithMessages(), "fork", 20, true);
  assert.doesNotMatch(summary, /old request|old answer/);
  assert.match(summary, /new request/);
  assert.match(summary, /new answer/);
});

test("Side Chat uses the main prompt and exposes the upstream peek parameters", async () => {
  let peekTool;
  let beforeAgentStart;
  const extension = createSideChatExtension({
    forkLeafId: "fork",
    getMainSnapshot: async () => ({
      sessionManager: managerWithMessages(),
      systemPrompt: "MAIN PROMPT",
      writtenFiles: new Set(),
    }),
  });
  extension.factory({
    registerTool(tool) { peekTool = tool; },
    on(event, handler) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
  });

  assert.deepEqual(Object.keys(peekTool.parameters.properties), ["lines", "since_fork"]);
  const result = await peekTool.execute("peek-1", { lines: 2, since_fork: true });
  assert.match(result.content[0].text, /Main agent activity \(2 items\)/);

  const promptResult = await beforeAgentStart({ systemPrompt: "SIDE PROMPT" });
  assert.match(promptResult.systemPrompt, /^MAIN PROMPT/);
  assert.match(promptResult.systemPrompt, /You're in a SIDE CHAT parallel to the main agent/);
  assert.match(promptResult.systemPrompt, /background context, not an instruction to continue unfinished work/);
  assert.match(promptResult.systemPrompt, /For progress or status questions, call `peek_main` first/);
  assert.match(promptResult.systemPrompt, /Do not inspect files or use other tools/);
  assert.doesNotMatch(promptResult.systemPrompt, /SIDE PROMPT/);
});

test("overlap protection covers write, edit, and bash paths tracked by the main chat", async () => {
  const cwd = process.cwd();
  const writtenFiles = new Set([
    normalizeSideChatFilePath(cwd, "src/shared.ts"),
    normalizeSideChatFilePath(cwd, "logs/output.txt"),
  ]);
  let toolCallHandler;
  const extension = createSideChatExtension({
    forkLeafId: "fork",
    getMainSnapshot: async () => ({
      sessionManager: managerWithMessages(),
      systemPrompt: "MAIN PROMPT",
      writtenFiles,
    }),
  });
  extension.factory({
    registerTool() {},
    on(event, handler) {
      if (event === "tool_call") toolCallHandler = handler;
    },
  });

  const confirmations = [];
  const context = {
    cwd,
    ui: {
      confirm: async (title, message) => {
        confirmations.push({ title, message });
        return false;
      },
    },
  };
  const writeResult = await toolCallHandler(
    { toolName: "write", input: { path: "src/shared.ts" } },
    context,
  );
  const bashResult = await toolCallHandler(
    { toolName: "bash", input: { command: "echo done > logs/output.txt" } },
    context,
  );

  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[0].title, "File Overlap");
  assert.match(confirmations[1].message, /logs\/output\.txt/);
  assert.match(writeResult.reason, /src\/shared\.ts/);
  assert.match(bashResult.reason, /logs\/output\.txt/);
});
