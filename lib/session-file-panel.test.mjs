import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-file-panel.ts");
}

test("capture keeps file tabs and surface while side chat is open", async () => {
  const { captureSessionFilePanelState } = await loadSubject();
  const tabs = [
    { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts", sourceSessionId: "A" },
  ];
  const captured = captureSessionFilePanelState({
    tabs,
    activeTabId: "file:/a.ts",
    rightPanelMode: "chat",
    previousSurfaceMode: "file",
  });
  assert.equal(captured.surfaceMode, "file");
  assert.deepEqual(captured.tabs.map((tab) => tab.id), ["file:/a.ts"]);
  assert.equal(captured.activeTabId, "file:/a.ts");
});

test("session switch restores B files and does not keep A tabs", async () => {
  const {
    captureSessionFilePanelState,
    emptySessionFilePanelState,
    resolveRightPanelModeOnSessionSwitch,
  } = await loadSubject();

  const aTabs = [{ id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" }];
  const bTabs = [{ id: "file:/b.ts", label: "b.ts", filePath: "/b.ts" }];

  const savedA = captureSessionFilePanelState({
    tabs: aTabs,
    activeTabId: "file:/a.ts",
    rightPanelMode: "file",
  });
  const map = new Map([
    ["A", savedA],
    ["B", captureSessionFilePanelState({
      tabs: bTabs,
      activeTabId: "file:/b.ts",
      rightPanelMode: "file",
    })],
  ]);

  // Leaving A is already captured; entering B loads B only.
  const restoredB = map.get("B") ?? emptySessionFilePanelState();
  assert.deepEqual(restoredB.tabs.map((tab) => tab.filePath), ["/b.ts"]);
  assert.notDeepEqual(restoredB.tabs, savedA.tabs);
  assert.equal(
    resolveRightPanelModeOnSessionSwitch({ sideChatOpen: false, restored: restoredB }),
    "file",
  );
});

test("side chat preference wins over restored file surface", async () => {
  const { captureSessionFilePanelState, resolveRightPanelModeOnSessionSwitch } = await loadSubject();
  const restored = captureSessionFilePanelState({
    tabs: [{ id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" }],
    activeTabId: "file:/a.ts",
    rightPanelMode: "file",
  });
  assert.equal(
    resolveRightPanelModeOnSessionSwitch({ sideChatOpen: true, restored }),
    "chat",
  );
});

test("blank panel after leave never carries file tabs", async () => {
  const { blankPanelAfterLeaveSession } = await loadSubject();
  assert.deepEqual(blankPanelAfterLeaveSession("file"), {
    tabs: [],
    activeTabId: null,
    mode: "closed",
  });
  assert.deepEqual(blankPanelAfterLeaveSession("explorer"), {
    tabs: [],
    activeTabId: null,
    mode: "explorer",
  });
  assert.deepEqual(blankPanelAfterLeaveSession("chat"), {
    tabs: [],
    activeTabId: null,
    mode: "closed",
  });
});

test("file surface with zero tabs collapses to closed on restore", async () => {
  const { resolveRightPanelModeOnSessionSwitch } = await loadSubject();
  assert.equal(
    resolveRightPanelModeOnSessionSwitch({
      sideChatOpen: false,
      restored: { tabs: [], activeTabId: null, surfaceMode: "file" },
    }),
    "closed",
  );
});
