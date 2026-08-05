import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-file-panel.ts");
}

test("capture keeps file tabs and active id", async () => {
  const { captureSessionFilePanelState } = await loadSubject();
  const tabs = [
    { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts", sourceSessionId: "A" },
  ];
  const captured = captureSessionFilePanelState({
    tabs,
    activeTabId: "file:/a.ts",
  });
  assert.deepEqual(captured.tabs.map((tab) => tab.id), ["file:/a.ts"]);
  assert.equal(captured.activeTabId, "file:/a.ts");
});

test("capture falls back active id to last tab", async () => {
  const { captureSessionFilePanelState } = await loadSubject();
  const captured = captureSessionFilePanelState({
    tabs: [
      { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
      { id: "file:/b.ts", label: "b.ts", filePath: "/b.ts" },
    ],
    activeTabId: "missing",
  });
  assert.equal(captured.activeTabId, "file:/b.ts");
});

test("session map restores B files and does not keep A tabs", async () => {
  const {
    captureSessionFilePanelState,
    emptySessionFilePanelState,
  } = await loadSubject();

  const savedA = captureSessionFilePanelState({
    tabs: [{ id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" }],
    activeTabId: "file:/a.ts",
  });
  const map = new Map([
    ["A", savedA],
    ["B", captureSessionFilePanelState({
      tabs: [{ id: "file:/b.ts", label: "b.ts", filePath: "/b.ts" }],
      activeTabId: "file:/b.ts",
    })],
  ]);

  const restoredB = map.get("B") ?? emptySessionFilePanelState();
  assert.deepEqual(restoredB.tabs.map((tab) => tab.filePath), ["/b.ts"]);
  assert.notDeepEqual(restoredB.tabs, savedA.tabs);
});

test("blank panel after leave never carries file tabs", async () => {
  const { blankPanelAfterLeaveSession } = await loadSubject();
  assert.deepEqual(blankPanelAfterLeaveSession(), {
    tabs: [],
    activeTabId: null,
  });
});
