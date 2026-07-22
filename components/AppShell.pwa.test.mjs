import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const update = readFileSync(new URL("../hooks/usePwaUpdate.ts", import.meta.url), "utf8");

test("AppShell mounts headless push, offline, update, and toast UI only", () => {
  assert.match(shell, /useWebPush\(\)/);
  assert.doesNotMatch(shell, /PwaInstallPrompt|PwaSettingsControl|PushNotificationControl/);
  assert.match(shell, /<OfflineBanner/);
  assert.match(shell, /<PwaUpdateBanner/);
  assert.match(shell, /<AppToast/);
  assert.doesNotMatch(shell, /usePwaInstall/);
  assert.doesNotMatch(shell, /Install help/);
});

test("update hook registers root sw and reloads only with a tab-local request", () => {
  assert.match(update, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(update, /reloadRequestedRef\.current/);
  assert.match(update, /controllerChangeAction\(reloadRequestedRef\.current,\s*hadController\)/);
  assert.match(update, /if \(activatedElsewhere\)[\s\S]*window\.location\.reload\(\)/);
  assert.doesNotMatch(update, /localStorage.*reloadRequested/);
});

test("update hook ignores first control acquisition and recovers stuck applying", () => {
  assert.match(update, /hadControllerRef/);
  assert.match(update, /action === "ignore"|action !== "ignore"|case "ignore"|if \(action === "reload"\)/);
  // updatefound race: inspect current state immediately after attaching statechange.
  assert.match(update, /addEventListener\("statechange"[\s\S]{0,200}onStateChange\(\)/);
  // Bounded applying recovery keeps UI retryable without auto-reload.
  assert.match(update, /APPLY_TIMEOUT_MS|setTimeout/);
  assert.match(update, /setApplying\(false\)/);
  assert.doesNotMatch(update, /localStorage.*reloadRequested/);
  assert.doesNotMatch(update, /BroadcastChannel/);
});

test("update hook registers SW on localhost/dev, not production-only", () => {
  // Approved design requires SW registration in development so install/Push can be
  // tested; conservative SW intentionally does not touch HMR assets.
  assert.match(update, /serviceWorker\.register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.doesNotMatch(update, /process\.env\.NODE_ENV\s*!==\s*["']production["']/);
  assert.doesNotMatch(update, /process\.env\.NODE_ENV\s*===\s*["']production["']/);
});

test("AppShell uses presence running set without recreating an empty set each render", () => {
  assert.match(shell, /const presence = useAppPresence\(\)/);
  assert.match(shell, /runningSessionIds = presence\.runningSessionIds/);
  assert.doesNotMatch(
    shell,
    /const runningSessionIds = new Set<string>\(\);/,
  );
});
