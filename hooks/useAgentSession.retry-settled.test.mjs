import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const start = source.indexOf('case "agent_end"');
const end = source.indexOf('case "prompt_done"', start);
const block = source.slice(start, end);

test("retrying agent_end does not finish foreground streaming state", () => {
  assert.match(block, /event\.willRetry/);
  const guard = block.indexOf("event.willRetry");
  const finish = block.indexOf("setAgentRunning(false)");
  assert.ok(guard >= 0 && guard < finish);
});
