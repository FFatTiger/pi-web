import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const controlPath = new URL("./PushNotificationControl.tsx", import.meta.url);
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("PushNotificationControl is removed and AppShell no longer references it", () => {
  assert.equal(existsSync(controlPath), false);
  assert.doesNotMatch(shell, /PushNotificationControl/);
  assert.doesNotMatch(shell, /PwaInstallPrompt/);
  assert.doesNotMatch(shell, /PwaSettingsControl/);
});
