import assert from "node:assert/strict";
import test from "node:test";

async function load() {
  return import("./right-panel-tabs.ts");
}

test("openOrFocus appends then focuses existing files tab", async () => {
  const { openOrFocusRightPanelTab, emptyRightPanelTabs } = await load();
  const empty = emptyRightPanelTabs();
  const withFiles = openOrFocusRightPanelTab(empty.tabs, "files");
  assert.equal(withFiles.tabs.length, 1);
  assert.equal(withFiles.tabs[0].kind, "files");
  const refocus = openOrFocusRightPanelTab(withFiles.tabs, "files");
  assert.equal(refocus.tabs.length, 1);
  assert.equal(refocus.activeTabId, withFiles.activeTabId);
});

test("multiple side chat tabs use sidechat:{id} and can coexist", async () => {
  const {
    openOrFocusSideChatPanelTab,
    listSideChatTabs,
    replaceSideChatPanelTab,
  } = await load();
  const first = openOrFocusSideChatPanelTab([], {
    sideSessionId: "s1",
    title: "One",
  });
  const second = openOrFocusSideChatPanelTab(first.tabs, {
    sideSessionId: "s2",
    title: "Two",
    forceNew: true,
  });
  assert.equal(listSideChatTabs(second.tabs).length, 2);
  assert.equal(second.tabs[0].id, "sidechat:s1");
  assert.equal(second.tabs[1].id, "sidechat:s2");
  const replaced = replaceSideChatPanelTab(second.tabs, "s1", {
    sideSessionId: "s3",
    title: "Reborn",
  });
  assert.equal(listSideChatTabs(replaced.tabs).length, 2);
  assert.equal(replaced.tabs.some((t) => t.sideSessionId === "s1"), false);
  assert.equal(replaced.tabs.some((t) => t.sideSessionId === "s3"), true);
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
  const { openOrFocusSideChatPanelTab, closeRightPanelTab } = await load();
  const opened = openOrFocusSideChatPanelTab([], { sideSessionId: "s1" });
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
