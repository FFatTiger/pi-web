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
  assert.match(update, /controllerChangeAction\(reloadRequestedRef\.current\)/);
  assert.match(update, /if \(activatedElsewhere\)[\s\S]*window\.location\.reload\(\)/);
  assert.doesNotMatch(update, /localStorage.*reloadRequested/);
});
