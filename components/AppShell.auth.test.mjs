import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

const authImport = source.indexOf('import { AuthControls } from "./AuthControls"');
const authUsage = source.indexOf("<AuthControls");
const sidebarContentStart = source.indexOf("const sidebarContent = (");
const sidebarContentEnd = source.indexOf("return (", sidebarContentStart + 1);
const sidebarBlock = source.slice(sidebarContentStart, sidebarContentEnd);
const topBarStart = source.indexOf('{/* Top bar with sidebar toggle */}');
const topBarEnd = source.indexOf('{/* Top panel dropdown — shared, only one active at a time */}');
const topBarBlock = source.slice(topBarStart, topBarEnd);
const bottomRightStart = source.indexOf('{/* Fixed bottom-right authentication and notification controls */}');
const bottomRightEnd = source.indexOf('{/* Fixed right-corner controls: explorer then file detail */}');
const bottomRightBlock = source.slice(bottomRightStart, bottomRightEnd);

test("AppShell imports AuthControls", () => {
  assert.ok(authImport >= 0, "missing AuthControls import");
  assert.match(source, /import\s*\{\s*AuthControls\s*\}\s*from\s*"\.\/AuthControls"/);
});

test("AuthControls and PushNotificationControl share the fixed bottom-right group", () => {
  assert.ok(bottomRightStart >= 0 && bottomRightEnd > bottomRightStart, "bottom-right control markers missing");
  assert.ok(authUsage > bottomRightStart && authUsage < bottomRightEnd, "AuthControls must be in bottom-right fixed control");
  assert.match(bottomRightBlock, /position:\s*"fixed"/);
  assert.match(bottomRightBlock, /right:\s*12/);
  assert.match(bottomRightBlock, /bottom:\s*12/);
  assert.match(bottomRightBlock, /<PushNotificationControl/);
  assert.match(bottomRightBlock, /<AuthControls\s*\/>/);
});

test("AuthControls is not placed in the sidebar footer", () => {
  assert.ok(sidebarContentStart >= 0 && sidebarContentEnd > sidebarContentStart, "sidebarContent block missing");
  assert.equal(sidebarBlock.includes("<AuthControls"), false);
  assert.match(sidebarBlock, /label:\s*"Models"/);
  assert.match(sidebarBlock, /label:\s*"Skills"/);
  assert.match(sidebarBlock, /label:\s*"Plugins"/);
});

test("AuthControls is not placed in the top bar", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart, "top bar markers missing");
  assert.equal(topBarBlock.includes("<AuthControls"), false);
});

test("session stats remain right-aligned with fixed-button clearance", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart);
  assert.match(topBarBlock, /marginLeft:\s*"auto"/);
  assert.match(
    topBarBlock,
    /paddingRight:\s*rightPanelMode\s*===\s*"closed"\s*\?\s*84\s*:\s*12/,
  );
});

test("AuthControls is not placed in the fixed Explorer/File group", () => {
  const explorerGroupStart = source.indexOf('{/* Fixed right-corner controls: explorer then file detail */}');
  assert.ok(explorerGroupStart >= 0, "explorer/file fixed group marker missing");
  const explorerGroupEnd = source.indexOf("{modelsConfigOpen &&", explorerGroupStart);
  assert.ok(explorerGroupEnd > explorerGroupStart, "explorer/file fixed group end missing");
  const fixedRegion = source.slice(explorerGroupStart, explorerGroupEnd);
  assert.equal(fixedRegion.includes("<AuthControls"), false);
  assert.match(fixedRegion, /rightPanelMode === "explorer"/);
  assert.match(fixedRegion, /rightPanelMode === "file"/);
});
