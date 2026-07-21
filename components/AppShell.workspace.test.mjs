import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const activationStart = source.indexOf("const activateWorkspace");
const activationEnd = source.indexOf("const handleSelectProject", activationStart);
const activationBlock = source.slice(activationStart, activationEnd);

test("workspace selection preserves the open chat and session URL", () => {
  assert.ok(activationStart >= 0 && activationEnd > activationStart);
  assert.doesNotMatch(activationBlock, /setSelectedSession\s*\(/);
  assert.doesNotMatch(activationBlock, /setNewSessionCwd\s*\(/);
  assert.doesNotMatch(activationBlock, /setSessionKey\s*\(/);
  assert.doesNotMatch(activationBlock, /router\.replace\s*\(/);
});

test("workspace selection alone does not synthesize a new-session input", () => {
  assert.match(source, /const effectiveNewSessionCwd = newSessionCwd;/);
});
