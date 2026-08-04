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

test("session stats are no longer duplicated in the top bar", () => {
  assert.ok(topBarStart >= 0 && topBarEnd > topBarStart);
  assert.match(topBarBlock, /Session statistics moved to the composer footer/);
  assert.doesNotMatch(topBarBlock, /paddingRight:\s*rightPanelMode\s*===\s*"closed"\s*\?\s*48\s*:\s*12/);
  assert.doesNotMatch(topBarBlock, /\{fmt\(t\.input\)\}/);
});

test("fixed right corner uses Codex expand/close cluster for the RIGHT panel", () => {
  const groupStart = source.indexOf("{/* Codex right-panel chrome: floating expand + close cluster");
  assert.ok(groupStart >= 0, "top-right right-panel cluster marker missing");
  const groupEnd = source.indexOf("{modelsConfigOpen &&", groupStart);
  assert.ok(groupEnd > groupStart, "top-right control group end missing");
  const fixedRegion = source.slice(groupStart, groupEnd);
  assert.equal(fixedRegion.includes("<AuthControls"), false);
  assert.match(fixedRegion, /codex-panel-control-cluster/);
  assert.match(fixedRegion, /toggleRightPanelMaximized/);
  assert.match(fixedRegion, /closeRightPanel/);
  assert.match(fixedRegion, /layout\.expandPanel/);
  assert.match(fixedRegion, /layout\.closePanel/);
  assert.doesNotMatch(fixedRegion, /handleSidebarToggle/);
  assert.doesNotMatch(fixedRegion, /toggleSideChatPanel/);
  assert.doesNotMatch(fixedRegion, /toggleExplorerPanel/);
});

test("Side Chat open state is remembered per main session", () => {
  assert.match(source, /sideChatOpenBySessionRef/);
  assert.match(source, /rememberSideChatOpen\(selectedSession\.id, true\)/);
  assert.match(source, /rememberSideChatOpen\(selectedSession\.id, false\)/);
  assert.match(source, /applySessionFilePanel\(session\.id\)/);
  assert.match(source, /resolveRightPanelViewOnSessionSwitch/);
  assert.match(source, /onClose=\{closeRightPanel\}/);
  assert.match(source, /sideChatOpenBySessionRef\.current\.delete\(sessionId\)/);
  assert.match(source, /handleSessionDeleted[\s\S]*?setRightPanelOpen\(false\)/);
});

test("open file tabs are scoped per session like Codex", () => {
  assert.match(source, /filePanelBySessionRef/);
  assert.match(source, /captureCurrentSessionFilePanel/);
  assert.match(source, /applySessionFilePanel/);
  assert.match(source, /captureSessionFilePanelState/);
  assert.match(source, /emptySessionFilePanelState/);
  // Leaving A captures before restoring B.
  assert.match(source, /if \(activeSessionIdRef\.current && activeSessionIdRef\.current !== session\.id\)/);
  assert.match(source, /captureCurrentSessionFilePanel\(\)/);
  assert.match(source, /applySessionFilePanel\(session\.id\)/);
  // New / deleted sessions do not keep foreign tabs.
  assert.match(source, /applySessionFilePanel\(null\)/);
  assert.match(source, /filePanelBySessionRef\.current\.delete\(sessionId\)/);
});

test("right panel chrome is orthogonal open/surface/maximize", () => {
  assert.match(source, /const \[rightPanelOpen, setRightPanelOpen\]/);
  assert.match(source, /const \[rightPanelMaximized, setRightPanelMaximized\]/);
  assert.match(source, /const \[rightPanelSurface, setRightPanelSurface\]/);
  assert.match(source, /deriveRightPanelMode/);
  assert.match(source, /toggleRightPanelMaximized/);
  assert.match(source, /right-panel-maximized/);
  // Side chat toggles surface without a single-mode enum assignment to "chat" only.
  assert.match(source, /setRightPanelSurface\("sideChat"\)/);
  assert.match(source, /setRightPanelSurface\("explorer"\)/);
  assert.match(source, /setRightPanelSurface\("file"\)/);
});
