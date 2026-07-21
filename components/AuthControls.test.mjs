import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AuthControls.tsx", import.meta.url), "utf8");

test("AuthControls fetches gate status and logout endpoints", () => {
  assert.match(source, /fetch\("\/api\/gate\/status"/);
  assert.match(source, /fetch\("\/api\/gate\/logout"/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /window\.location\.assign\("\/login"\)/);
  assert.match(source, /认证已关闭/);
  assert.match(source, /configPath/);
  assert.match(source, /aria-label/);
});

test("status fetch uses cache no-store", () => {
  assert.match(
    source,
    /fetch\("\/api\/gate\/status",\s*\{\s*cache:\s*"no-store"\s*\}\)/,
  );
});

test("logout only redirects after successful POST", () => {
  const logoutStart = source.indexOf("async function handleLogout");
  assert.ok(logoutStart >= 0, "missing handleLogout");
  const logoutBlock = source.slice(logoutStart, source.indexOf("return", logoutStart + 1));
  assert.match(logoutBlock, /fetch\("\/api\/gate\/logout"/);
  assert.match(logoutBlock, /if\s*\(\s*!response\.ok\s*\)/);
  assert.match(logoutBlock, /window\.location\.assign\("\/login"\)/);
});

test("enabled, disabled, and null states are explicit", () => {
  assert.match(source, /status\.status === "enabled"/);
  assert.match(source, /status\.status === "disabled"/);
  assert.match(source, /return null/);
  assert.match(source, /loggingOut/);
});
