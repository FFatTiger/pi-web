import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const toggleStart = source.indexOf("const toggleProject");
const toggleEnd = source.indexOf("const startProjectSession", toggleStart);
const toggleBlock = source.slice(toggleStart, toggleEnd);

test("folder click only selects workspace when no session is open", () => {
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart);
  assert.match(toggleBlock, /if \(!selectedSessionId\) onSelectProject\(group\.root, group\.root\)/);
});
