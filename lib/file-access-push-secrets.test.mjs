import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import path from "node:path";

const jiti = createJiti(import.meta.url);
const paths = await jiti.import("./push-paths.ts");
const access = await jiti.import("./file-access.ts");
const agentDir = "/Users/example/.pi/agent";
const state = path.join(agentDir, "pi-web-push.json");

test("recognizes only the managed Push state file and atomic temp files", () => {
  assert.equal(paths.isPushSecretPath(state, agentDir), true);
  assert.equal(paths.isPushSecretPath(`${state}.tmp-abc`, agentDir), true);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "pi-web-push.json.bak"), agentDir), false);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "nested", "pi-web-push.json"), agentDir), false);
});

test("secret denial wins even when HOME or agent directory is an allowed root", () => {
  for (const roots of [new Set([agentDir]), new Set([path.dirname(agentDir)]), new Set(["/"])]) {
    assert.equal(access.isFilePathAllowed(state, roots, agentDir), false);
    assert.equal(access.isFilePathAllowed(`${state}.tmp-123`, roots, agentDir), false);
  }
  assert.equal(access.isFilePathAllowed(path.join(agentDir, "settings.json"), new Set([agentDir]), agentDir), true);
});
