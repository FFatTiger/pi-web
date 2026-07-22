import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const update = readFileSync(new URL("../hooks/usePwaUpdate.ts", import.meta.url), "utf8");

test("AppShell mounts install, update, and offline UI", () => {
  for (const name of ["OfflineBanner", "PwaInstallPrompt", "PwaSettingsControl", "PwaUpdateBanner"]) {
    assert.match(shell, new RegExp(`<${name}`));
  }
  assert.match(shell, /Install help/);
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
  // Production-only registration protects Next dev HMR.
  assert.match(update, /process\.env\.NODE_ENV\s*!==\s*["']production["']/);
  // updatefound race: inspect current state immediately after attaching statechange.
  assert.match(update, /addEventListener\("statechange"[\s\S]{0,200}onStateChange\(\)/);
  // Bounded applying recovery keeps UI retryable without auto-reload.
  assert.match(update, /APPLY_TIMEOUT_MS|setTimeout/);
  assert.match(update, /setApplying\(false\)/);
  assert.doesNotMatch(update, /localStorage.*reloadRequested/);
  assert.doesNotMatch(update, /BroadcastChannel/);
});

test("AppShell reuses a stable empty running set placeholder", () => {
  assert.match(shell, /EMPTY_RUNNING|EMPTY_RUNNING_SESSION_IDS|useMemo\(\(\) => new Set/);
  assert.doesNotMatch(
    shell,
    /const runningSessionIds = new Set<string>\(\);/,
  );
});
