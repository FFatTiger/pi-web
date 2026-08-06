import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const tabBar = readFileSync(new URL("./RightPanelTabBar.tsx", import.meta.url), "utf8");

const sidebarContentStart = source.indexOf("const sidebarContent = (");
const sidebarContentEnd = source.indexOf("return (", sidebarContentStart + 1);
const sidebarBlock = source.slice(sidebarContentStart, sidebarContentEnd);
const topBarStart = source.indexOf("{/* Codex toolbar: 46px row with icon buttons */}");
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

test("right panel actions use the Codex tab-strip after-list", () => {
  assert.match(tabBar, /right-panel-tabbar-actions/);
  assert.match(tabBar, /onToggleMaximized/);
  assert.match(tabBar, /onClosePanel/);
  assert.match(tabBar, /layout\.expandPanel/);
  assert.match(tabBar, /layout\.closePanel/);
  assert.match(tabBar, /data-app-shell-tab-controller="right"/);
  assert.doesNotMatch(source, /codex-panel-control-cluster/);
});

test("Side Chat open state is remembered per main session", () => {
  assert.match(source, /sideChatOpenBySessionRef/);
  assert.match(source, /rememberSideChatOpen\(sessionId, tabs\.some\(\(tab\) => tab\.kind === "sideChat"\)\)/);
  assert.match(source, /applySessionFilePanel\(session\.id\)/);
  assert.match(source, /rightPanelTabsBySessionRef/);
  assert.match(source, /openSideChatShell/);
  assert.match(source, /sideChatOpenBySessionRef\.current\.delete\(sessionId\)/);
  assert.match(source, /handleSessionDeleted[\s\S]*?setRightPanelOpen\(false\)/);
});

test("open file tabs are scoped per session like Codex", () => {
  assert.match(source, /rightPanelTabsBySessionRef/);
  assert.match(source, /captureCurrentSessionFilePanel/);
  assert.match(source, /applySessionFilePanel/);
  assert.match(source, /openOrFocusFilePanelTab/);
  // Leaving A captures before restoring B.
  assert.match(source, /if \(activeSessionIdRef\.current && activeSessionIdRef\.current !== session\.id\)/);
  assert.match(source, /captureCurrentSessionFilePanel\(\)/);
  assert.match(source, /applySessionFilePanel\(session\.id\)/);
  // New / deleted sessions do not keep foreign tabs.
  assert.match(source, /applySessionFilePanel\(null\)/);
  assert.match(source, /rightPanelTabsBySessionRef\.current\.delete\(sessionId\)/);
});

test("right panel chrome is multi-tab open/maximize (Codex RightPanelTabs)", () => {
  assert.match(source, /const \[rightPanelOpen, setRightPanelOpen\]/);
  assert.match(source, /const \[rightPanelMaximized, setRightPanelMaximized\]/);
  assert.match(source, /const \[rightPanelTabs, setRightPanelTabs\]/);
  assert.match(source, /const \[activeRightPanelTabId, setActiveRightPanelTabId\]/);
  assert.match(source, /openOrFocusRightPanelTab/);
  assert.match(source, /closeRightPanelTab/);
  assert.match(source, /toggleRightPanelMaximized/);
  assert.match(source, /right-panel-maximized/);
  // Codex multi-tab: side chat / files / open-file chips coexist as panel tabs.
  assert.match(source, /openSideChatShell/);
  assert.match(source, /openRightPanelKind\("files"/);
  assert.match(source, /openOrFocusFilePanelTab/);
  assert.match(source, /openOrFocusSideChatPanelTab/);
  assert.match(source, /rightPanelTabsBySessionRef/);
  assert.match(source, /explorerOpen/);
  assert.match(source, /ThreadSummaryPanel/);
});
