import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const controlPath = new URL("./PushNotificationControl.tsx", import.meta.url);
const installHookPath = new URL("../hooks/usePwaInstall.ts", import.meta.url);
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("guidance UI hooks and controls are removed from production", () => {
  assert.equal(existsSync(controlPath), false);
  assert.equal(existsSync(installHookPath), false);
  assert.doesNotMatch(shell, /PushNotificationControl/);
  assert.doesNotMatch(shell, /PwaInstallPrompt/);
  assert.doesNotMatch(shell, /PwaSettingsControl/);
  assert.doesNotMatch(shell, /usePwaInstall/);
});
