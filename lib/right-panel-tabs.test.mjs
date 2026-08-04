import assert from "node:assert/strict";
import test from "node:test";

async function load() {
  return import("./right-panel-tabs.ts");
}

test("openOrFocus appends then focuses existing tab", async () => {
  const { openOrFocusRightPanelTab, emptyRightPanelTabs } = await load();
  const empty = emptyRightPanelTabs();
  const withFiles = openOrFocusRightPanelTab(empty.tabs, "files");
  assert.equal(withFiles.tabs.length, 1);
  assert.equal(withFiles.tabs[0].kind, "files");
  const withBoth = openOrFocusRightPanelTab(withFiles.tabs, "sideChat");
  assert.equal(withBoth.tabs.map((t) => t.kind).join(","), "files,sideChat");
  const refocus = openOrFocusRightPanelTab(withBoth.tabs, "files");
  assert.equal(refocus.tabs.length, 2);
  assert.equal(refocus.activeTabId, withFiles.activeTabId);
});

test("openOrFocusFilePanelTab creates multiple top-level file chips", async () => {
  const { openOrFocusFilePanelTab, openOrFocusRightPanelTab } = await load();
  const shell = openOrFocusRightPanelTab([], "files");
  const a = openOrFocusFilePanelTab(shell.tabs, { filePath: "/repo/a.ts", fileName: "a.ts" });
  assert.equal(a.tabs.some((t) => t.kind === "files"), false);
  assert.equal(a.tabs.length, 1);
  const b = openOrFocusFilePanelTab(a.tabs, { filePath: "/repo/b.ts", fileName: "b.ts" });
  assert.equal(b.tabs.length, 2);
  assert.deepEqual(b.tabs.map((t) => t.title), ["a.ts", "b.ts"]);
  const refocusA = openOrFocusFilePanelTab(b.tabs, { filePath: "/repo/a.ts", fileName: "a.ts" });
  assert.equal(refocusA.tabs.length, 2);
  assert.equal(refocusA.activeTabId, a.activeTabId);
});

test("close last tab yields empty state", async () => {
  const { openOrFocusRightPanelTab, closeRightPanelTab } = await load();
  const opened = openOrFocusRightPanelTab([], "sideChat");
  const closed = closeRightPanelTab(opened.tabs, opened.activeTabId, opened.activeTabId);
  assert.deepEqual(closed, { tabs: [], activeTabId: null });
});

test("menu only exposes files and side chat", async () => {
  const { buildRightPanelMenuItems } = await load();
  const items = buildRightPanelMenuItems({ hasWorkspace: true, hasSession: true });
  assert.deepEqual(
    items.map((item) => item.id),
    ["files", "sideChat"],
  );
});
