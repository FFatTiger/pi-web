import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("SessionSidebar imports AuthControls", () => {
  assert.match(sidebar, /import \{ AuthControls \}/);
});

test("compact AuthControls sits after Refresh and Open directory, before AnimatedDropdown", () => {
  const refresh = sidebar.indexOf('aria-label="Refresh sessions"');
  const openDirectory = sidebar.indexOf('aria-label="Open directory"');
  const authControls = sidebar.indexOf("<AuthControls compact");
  const dropdown = sidebar.indexOf("<AnimatedDropdown");

  assert.ok(refresh >= 0, "missing Refresh sessions control");
  assert.ok(openDirectory > refresh, "Open directory must follow Refresh");
  assert.ok(authControls > openDirectory, "AuthControls compact must follow Open directory");
  assert.ok(dropdown > authControls, "AnimatedDropdown must follow AuthControls compact");
});

test("AppShell no longer owns AuthControls or the fixed bottom-right auth wrapper", () => {
  assert.doesNotMatch(shell, /<AuthControls/);
  assert.doesNotMatch(shell, /Fixed bottom-right authentication/);
});
