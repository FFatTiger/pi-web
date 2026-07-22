import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

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

test("denies case aliases of the managed Push state file and temp siblings", () => {
  // Security-preserving policy: secret identity is case-insensitive so Darwin/Windows
  // aliases cannot bypass denial. Nested paths and .bak remain allowed.
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "PI-WEB-PUSH.JSON"), agentDir), true);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "Pi-Web-Push.JSON.tmp-XYZ"), agentDir), true);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "PI-WEB-PUSH.JSON.BAK"), agentDir), false);
  assert.equal(paths.isPushSecretPath(path.join(agentDir, "nested", "PI-WEB-PUSH.JSON"), agentDir), false);
  assert.equal(access.isFilePathDenied(path.join(agentDir, "PI-WEB-PUSH.JSON"), agentDir), true);
  assert.equal(
    access.isFilePathAllowed(path.join(agentDir, "PI-WEB-PUSH.JSON"), new Set(["/"]), agentDir),
    false,
  );
});

test("secret denial wins even when HOME or agent directory is an allowed root", () => {
  for (const roots of [new Set([agentDir]), new Set([path.dirname(agentDir)]), new Set(["/"])]) {
    assert.equal(access.isFilePathAllowed(state, roots, agentDir), false);
    assert.equal(access.isFilePathAllowed(`${state}.tmp-123`, roots, agentDir), false);
  }
  assert.equal(access.isFilePathAllowed(path.join(agentDir, "settings.json"), new Set([agentDir]), agentDir), true);
});

test("isFilePathAllowed uses resolved denial for symlinks to the secret", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-push-sec-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const agent = path.join(root, "agent");
  const other = path.join(root, "other");
  fs.mkdirSync(agent);
  fs.mkdirSync(other);
  const secret = path.join(agent, "pi-web-push.json");
  fs.writeFileSync(secret, "{}");
  const leak = path.join(other, "harmless-name.json");
  fs.symlinkSync(secret, leak);

  assert.equal(access.isResolvedFilePathDenied(leak, agent), true);
  assert.equal(access.isFilePathAllowed(leak, new Set([other, root, "/"]), agent), false);
  assert.equal(access.isFilePathAllowed(path.join(other, "notes.txt"), new Set([other]), agent), true);
});

test("denies non-existing upload destinations under a symlinked agent parent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-push-parent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const agent = path.join(root, "agent");
  fs.mkdirSync(agent);
  fs.writeFileSync(path.join(agent, "pi-web-push.json"), "{}");
  const agentLink = path.join(root, "agent-link");
  fs.symlinkSync(agent, agentLink);

  const missingTemp = path.join(agentLink, "pi-web-push.json.tmp-new");
  assert.equal(fs.existsSync(missingTemp), false);
  assert.equal(access.isResolvedFilePathDenied(missingTemp, agent), true);
  assert.equal(access.isFilePathAllowed(missingTemp, new Set([root, "/"]), agent), false);

  const missingCase = path.join(agentLink, "PI-WEB-PUSH.JSON");
  assert.equal(access.isResolvedFilePathDenied(missingCase, agent), true);
});

test("filterDeniedFileIndexPaths removes secrets, temps, and symlink aliases", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-push-index-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const agent = path.join(root, "agent");
  fs.mkdirSync(agent);
  fs.writeFileSync(path.join(agent, "pi-web-push.json"), "{}");
  fs.writeFileSync(path.join(agent, "pi-web-push.json.tmp-abc"), "tmp");
  fs.writeFileSync(path.join(agent, "settings.json"), "{}");
  fs.writeFileSync(path.join(agent, "pi-web-push.json.bak"), "bak");
  fs.mkdirSync(path.join(agent, "nested"));
  fs.writeFileSync(path.join(agent, "nested", "pi-web-push.json"), "nested");
  fs.symlinkSync(path.join(agent, "pi-web-push.json"), path.join(agent, "alias-link.json"));

  const filtered = access.filterDeniedFileIndexPaths(
    [
      "pi-web-push.json",
      "pi-web-push.json.tmp-abc",
      "PI-WEB-PUSH.JSON",
      "settings.json",
      "pi-web-push.json.bak",
      "nested/pi-web-push.json",
      "alias-link.json",
    ],
    agent,
    agent,
  );

  assert.deepEqual(filtered.sort(), [
    "nested/pi-web-push.json",
    "pi-web-push.json.bak",
    "settings.json",
  ].sort());
});
