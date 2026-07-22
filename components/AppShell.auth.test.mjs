import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

const sidebarContentStart = source.indexOf("const sidebarContent = (");
const sidebarContentEnd = source.indexOf("return (", sidebarContentStart + 1);
const sidebarBlock = source.slice(sidebarContentStart, sidebarContentEnd);
const topBarStart = source.indexOf("{/* Top bar with sidebar toggle */}");
const topBarEnd = source.indexOf("{/* Top panel dropdown — shared, only one active at a time */}");
const topBarBlock = source.slice(topBarStart, topBarEnd);

test("AppShell does not import or render AuthControls", () => {
  assert.doesNotMatch(source, /import\s*\{\s*AuthControls\s*\}\s*from\s*"\.\/AuthControls"/);
  assert.doesNotMatch(source, /<AuthControls/);
  assert.doesNotMatch(source, /Fixed bottom-right authentication/);
});

test("authentication is delegated to SessionSidebar", () => {
  assert.match(source, /import\s*\{\s*SessionSidebar\s*\}\s*from\s*"\.\/SessionSidebar"/);
  assert.match(source, /<SessionSidebar[\s\S]*?\/>/);
});

test("sidebar content still hosts Models/Skills/Plugins labels", () => {
  assert.ok(sidebarContentStart >= 0 && sidebarContentEnd > sidebarContentStart, "sidebarContent block missing");
  assert.match(sidebarBlock, /label:\s*"Models"/);
  assert.match(sidebarBlock, /label:\s*"Skills"/);
  assert.match(sidebarBlock, /label:\s*"Plugins"/);
});

test("AuthControls is not placed in the top bar", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart, "top bar markers missing");
  assert.equal(topBarBlock.includes("<AuthControls"), false);
});

test("session stats remain right-aligned with single explorer-button clearance", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart);
  assert.match(topBarBlock, /marginLeft:\s*"auto"/);
  assert.match(
    topBarBlock,
    /paddingRight:\s*rightPanelMode\s*===\s*"closed"\s*\?\s*48\s*:\s*12/,
  );
});

test("fixed right corner keeps only the Explorer entry", () => {
  const explorerGroupStart = source.indexOf("{/* Fixed right-corner control: file explorer */}");
  assert.ok(explorerGroupStart >= 0, "explorer fixed group marker missing");
  const explorerGroupEnd = source.indexOf("{modelsConfigOpen &&", explorerGroupStart);
  assert.ok(explorerGroupEnd > explorerGroupStart, "explorer fixed group end missing");
  const fixedRegion = source.slice(explorerGroupStart, explorerGroupEnd);
  assert.equal(fixedRegion.includes("<AuthControls"), false);
  assert.match(fixedRegion, /rightPanelMode === "explorer"/);
  assert.doesNotMatch(fixedRegion, /rightPanelMode === "file"/);
  assert.doesNotMatch(fixedRegion, /toggleFilePanel/);
});
