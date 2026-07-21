import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

const topBarStart = source.indexOf('{/* Top bar with sidebar toggle */}');
const topBarEnd = source.indexOf('{/* Top panel dropdown — shared, only one active at a time */}');
const topBarBlock = source.slice(topBarStart, topBarEnd);

const statsCondition = "showChat && (sessionStats || contextUsage)";
const statsStart = source.indexOf(statsCondition);
const authImport = source.indexOf('import { AuthControls } from "./AuthControls"');
const authUsage = source.indexOf("<AuthControls");

test("AppShell imports AuthControls", () => {
  assert.ok(authImport >= 0, "missing AuthControls import");
  assert.match(source, /import\s*\{\s*AuthControls\s*\}\s*from\s*"\.\/AuthControls"/);
});

test("AuthControls is mounted in the top-bar document flow", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart, "top bar markers missing");
  assert.ok(authUsage > topBarStart && authUsage < topBarEnd, "AuthControls must be inside top bar");
  assert.match(topBarBlock, /<AuthControls\s*\/>/);
});

test("AuthControls is outside the session-stats conditional", () => {
  assert.ok(statsStart >= 0, "session stats condition missing");
  assert.ok(authUsage >= 0, "AuthControls usage missing");

  // AuthControls must not live only inside the stats IIFE/conditional.
  // Find the closing of that conditional block and ensure AuthControls is not nested solely in it.
  const statsBlockStart = source.lastIndexOf("{/* Session stats", statsStart + 1);
  const statsMarker = statsBlockStart >= 0 ? statsBlockStart : statsStart;
  // If AuthControls appears after the stats condition expression, ensure it's a sibling via wrapper.
  assert.ok(
    !source.slice(statsStart, statsStart + 400).includes("<AuthControls"),
    "AuthControls must not be nested inside the showChat && (sessionStats || contextUsage) condition expression",
  );

  // AuthControls should appear even when stats condition is false — i.e. rendered outside that condition.
  const wrapperStart = source.indexOf('marginLeft: "auto"');
  assert.ok(wrapperStart >= 0, "right-aligned wrapper with marginLeft auto missing");

  // Auth usage should be near the right-aligned wrapper, not gated by showChat alone for the whole right side.
  const authInTopBar = topBarBlock.includes("<AuthControls");
  assert.equal(authInTopBar, true);

  // The stats condition must still exist for the stats button, but AuthControls must also appear when that is false.
  // Contract: AuthControls JSX is not inside the `showChat && (sessionStats || contextUsage) && (() => {` IIFE.
  const statsIife = source.indexOf("showChat && (sessionStats || contextUsage) && (() => {");
  assert.ok(statsIife >= 0, "stats IIFE missing");
  const statsIifeEnd = source.indexOf("})()}", statsIife);
  assert.ok(statsIifeEnd > statsIife, "stats IIFE end missing");
  const statsIifeBlock = source.slice(statsIife, statsIifeEnd);
  assert.equal(
    statsIifeBlock.includes("<AuthControls"),
    false,
    "AuthControls must be outside the session stats IIFE",
  );
});

test("right-aligned auth wrapper preserves fixed-button clearance", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart);
  assert.match(
    topBarBlock,
    /marginLeft:\s*"auto"/,
  );
  assert.match(
    topBarBlock,
    /paddingRight:\s*rightPanelMode\s*===\s*"closed"\s*\?\s*84\s*:\s*12/,
  );
  assert.match(topBarBlock, /flexShrink:\s*0/);
});

test("AuthControls is not placed in the fixed Explorer/File group", () => {
  const fixedGroupStart = source.indexOf('position: "fixed"');
  // There may be multiple fixed elements; check the Explorer/File buttons region.
  const explorerTitle = source.indexOf('title={rightPanelMode === "explorer"');
  assert.ok(explorerTitle >= 0);
  const fixedRegion = source.slice(Math.max(0, explorerTitle - 400), explorerTitle + 800);
  assert.equal(fixedRegion.includes("<AuthControls"), false);
});
