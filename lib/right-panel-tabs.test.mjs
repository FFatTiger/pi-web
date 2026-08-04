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

test("close last tab yields empty state", async () => {
  const { openOrFocusRightPanelTab, closeRightPanelTab } = await load();
  const opened = openOrFocusRightPanelTab([], "sideChat");
  const closed = closeRightPanelTab(opened.tabs, opened.activeTabId, opened.activeTabId);
  assert.deepEqual(closed, { tabs: [], activeTabId: null });
});

test("menu order matches Codex git sort", async () => {
  const { buildRightPanelMenuItems } = await load();
  const items = buildRightPanelMenuItems({ hasWorkspace: true, hasSession: true });
  assert.deepEqual(
    items.map((item) => item.id),
    ["review", "terminal", "browser", "files", "sideChat"],
  );
  assert.equal(items.find((i) => i.id === "files")?.shortcut, "Ctrl+P");
  assert.equal(items.find((i) => i.id === "sideChat")?.shortcut, "Ctrl+Alt+S");
  assert.equal(items.find((i) => i.id === "terminal")?.available, false);
});
