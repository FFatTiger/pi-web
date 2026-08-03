import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("session statistics render in the composer footer instead of duplicating in the top bar", () => {
  assert.match(appShell, /Session statistics moved to the composer footer/);
  assert.doesNotMatch(appShell, /Session stats — right-aligned in top bar/);
  assert.doesNotMatch(appShell, /onClick=\{\(\) => toggleTopPanel\("session"\)\}[\s\S]*?\{fmt\(t\.input\)\}/);
  assert.match(appShell, /activeTopPanel === "session"/);
  assert.match(appShell, /const openSessionStatsPanel = useCallback/);
});
