import type { Tab } from "@/components/TabBar";
import type { RightPanelMode } from "@/components/WorkspaceFilePanel";

/** Non-chat right-panel surfaces that should be restored per session. */
export type FilePanelSurfaceMode = "closed" | "explorer" | "file";

/**
 * Codex-style open-files state scoped to one conversation/session.
 * Side Chat open/closed is tracked separately; this only owns file tabs +
 * the last non-chat surface (explorer/file/closed).
 */
export type SessionFilePanelState = {
  tabs: Tab[];
  activeTabId: string | null;
  surfaceMode: FilePanelSurfaceMode;
};

export function emptySessionFilePanelState(): SessionFilePanelState {
  return { tabs: [], activeTabId: null, surfaceMode: "closed" };
}

export function isFilePanelSurfaceMode(mode: RightPanelMode): mode is FilePanelSurfaceMode {
  return mode === "closed" || mode === "explorer" || mode === "file";
}

/**
 * Snapshot the file panel for the session being left.
 * When Side Chat is open, keep the previous non-chat surface (or infer file
 * if tabs exist) so returning without side-chat restores explorer/file.
 */
export function captureSessionFilePanelState(input: {
  tabs: Tab[];
  activeTabId: string | null;
  rightPanelMode: RightPanelMode;
  /** Last known non-chat surface while Side Chat is showing. */
  previousSurfaceMode?: FilePanelSurfaceMode | null;
}): SessionFilePanelState {
  const surfaceMode: FilePanelSurfaceMode = input.rightPanelMode === "chat"
    ? (input.previousSurfaceMode
      ?? (input.tabs.length > 0 ? "file" : "closed"))
    : input.rightPanelMode;

  const activeTabId = input.activeTabId
    && input.tabs.some((tab) => tab.id === input.activeTabId)
    ? input.activeTabId
    : (input.tabs[input.tabs.length - 1]?.id ?? null);

  return {
    tabs: input.tabs.map((tab) => ({ ...tab })),
    activeTabId,
    surfaceMode: surfaceMode === "file" && input.tabs.length === 0 ? "closed" : surfaceMode,
  };
}

/** Resolve panel mode when entering a session (Side Chat wins over file surface). */
export function resolveRightPanelModeOnSessionSwitch(input: {
  sideChatOpen: boolean;
  restored: SessionFilePanelState;
}): RightPanelMode {
  if (input.sideChatOpen) return "chat";
  if (input.restored.surfaceMode === "file" && input.restored.tabs.length === 0) {
    return "closed";
  }
  return input.restored.surfaceMode;
}

/** New / blank composer: never carry another session's open files. */
export function blankPanelAfterLeaveSession(currentMode: RightPanelMode): {
  tabs: Tab[];
  activeTabId: string | null;
  mode: RightPanelMode;
} {
  const mode = currentMode === "file" || currentMode === "chat" ? "closed" : currentMode;
  return { tabs: [], activeTabId: null, mode };
}
