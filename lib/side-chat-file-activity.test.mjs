import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  collectMainMutatedFilePaths,
  extractWritePaths,
  getMainSessionWrittenFiles,
  normalizeSideChatFilePath,
  trackMainSessionToolCall,
} = await jiti.import("./side-chat-file-activity.ts");

test("write-path extraction matches upstream shell behavior", () => {
  assert.deepEqual(extractWritePaths("write", { path: "src/a.ts" }), ["src/a.ts"]);
  assert.deepEqual(
    extractWritePaths("bash", { command: "touch one.txt && cp source.txt target.txt; echo ok >> logs/run.log" }),
    ["one.txt", "target.txt", "logs/run.log"],
  );
});

test("write-path extraction supports PowerShell file commands", () => {
  assert.deepEqual(
    extractWritePaths("bash", {
      command: "Set-Content -LiteralPath 'src/a.txt' -Value x; Get-Content in.txt | Out-File -FilePath out.txt; Remove-Item old.txt",
    }),
    ["src/a.txt", "out.txt", "old.txt"],
  );
  assert.deepEqual(
    extractWritePaths("bash", { command: "Copy-Item source.txt copied.txt; Move-Item copied.txt moved.txt" }),
    ["copied.txt", "moved.txt"],
  );
});

test("historical overlap tracking scans the full active branch", () => {
  const cwd = process.cwd();
  const branch = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "write", arguments: { path: "before-fork.ts" } }],
      },
    },
    { type: "message", message: { role: "user", content: "fork here" } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "bash", arguments: { command: "echo x > after-fork.ts" } }],
      },
    },
  ];
  const paths = collectMainMutatedFilePaths({ getBranch: () => branch, getCwd: () => cwd });
  assert.deepEqual(paths, new Set([
    normalizeSideChatFilePath(cwd, "before-fork.ts"),
    normalizeSideChatFilePath(cwd, "after-fork.ts"),
  ]));
});

test("live main-agent tool events are retained by session", () => {
  const cwd = process.cwd();
  const sessionId = `main-${Date.now()}-${Math.random()}`;
  trackMainSessionToolCall(sessionId, cwd, "edit", { path: "src/live.ts" });
  trackMainSessionToolCall(sessionId, cwd, "bash", { command: "Add-Content live.log done" });
  assert.deepEqual(getMainSessionWrittenFiles(sessionId), new Set([
    normalizeSideChatFilePath(cwd, "src/live.ts"),
    normalizeSideChatFilePath(cwd, "live.log"),
  ]));
});
