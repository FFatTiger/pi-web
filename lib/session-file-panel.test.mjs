import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-file-panel.ts");
}

test("capture keeps file tabs and files surface while side chat is open", async () => {
  const { captureSessionFilePanelState } = await loadSubject();
  const tabs = [
    { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts", sourceSessionId: "A" },
  ];
  const captured = captureSessionFilePanelState({
    tabs,
    activeTabId: "file:/a.ts",
    filesSurface: "file",
    previousFilesSurface: "file",
  });
  assert.equal(captured.filesSurface, "file");
  assert.deepEqual(captured.tabs.map((tab) => tab.id), ["file:/a.ts"]);
  assert.equal(captured.activeTabId, "file:/a.ts");
});

test("session switch restores B files and does not keep A tabs", async () => {
  const {
    captureSessionFilePanelState,
    emptySessionFilePanelState,
    resolveRightPanelViewOnSessionSwitch,
  } = await loadSubject();

  const aTabs = [{ id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" }];
  const bTabs = [{ id: "file:/b.ts", label: "b.ts", filePath: "/b.ts" }];

  const savedA = captureSessionFilePanelState({
    tabs: aTabs,
    activeTabId: "file:/a.ts",
    filesSurface: "file",
  });
  const map = new Map([
    ["A", savedA],
    ["B", captureSessionFilePanelState({
      tabs: bTabs,
      activeTabId: "file:/b.ts",
      filesSurface: "file",
    })],
  ]);

  const restoredB = map.get("B") ?? emptySessionFilePanelState();
  assert.deepEqual(restoredB.tabs.map((tab) => tab.filePath), ["/b.ts"]);
  assert.notDeepEqual(restoredB.tabs, savedA.tabs);
  assert.deepEqual(
    resolveRightPanelViewOnSessionSwitch({ sideChatOpen: false, restored: restoredB }),
    { open: true, surface: "file" },
  );
});

test("side chat preference opens chat surface without dropping restored tabs", async () => {
  const { captureSessionFilePanelState, resolveRightPanelViewOnSessionSwitch } = await loadSubject();
  const restored = captureSessionFilePanelState({
    tabs: [{ id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" }],
    activeTabId: "file:/a.ts",
    filesSurface: "file",
  });
  assert.deepEqual(
    resolveRightPanelViewOnSessionSwitch({ sideChatOpen: true, restored }),
    { open: true, surface: "sideChat" },
  );
  // Tabs remain in snapshot for when side chat closes.
  assert.equal(restored.tabs.length, 1);
});

test("blank panel after leave never carries file tabs", async () => {
  const { blankPanelAfterLeaveSession } = await loadSubject();
  assert.deepEqual(blankPanelAfterLeaveSession(), {
    tabs: [],
    activeTabId: null,
    filesSurface: "file",
    open: false,
    surface: "file",
  });
});

test("file surface with zero tabs collapses to closed on restore", async () => {
  const { resolveRightPanelViewOnSessionSwitch } = await loadSubject();
  assert.deepEqual(
    resolveRightPanelViewOnSessionSwitch({
      sideChatOpen: false,
      restored: { tabs: [], activeTabId: null, filesSurface: "file" },
    }),
    { open: false, surface: "file" },
  );
});

test("deriveRightPanelMode maps open+surface to legacy mode", async () => {
  const { deriveRightPanelMode } = await loadSubject();
  assert.equal(deriveRightPanelMode({ open: false, surface: "file" }), "closed");
  assert.equal(deriveRightPanelMode({ open: true, surface: "explorer" }), "explorer");
  assert.equal(deriveRightPanelMode({ open: true, surface: "file" }), "file");
  assert.equal(deriveRightPanelMode({ open: true, surface: "sideChat" }), "chat");
});
