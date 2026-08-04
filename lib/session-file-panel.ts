import type { Tab } from "@/components/TabBar";

/** Files surfaces shown in the right panel body (not side chat). */
export type FilesSurface = "explorer" | "file";

/**
 * Codex-style right-panel content scoped to one conversation.
 * Layout chrome (open/maximized/width) is window-level; this snapshot is
 * the session's open files + last files surface.
 */
export type SessionFilePanelState = {
  tabs: Tab[];
  activeTabId: string | null;
  /** Last non-chat surface for this session (explorer or file). */
  filesSurface: FilesSurface;
};

/** @deprecated use FilesSurface — kept for call-site migration */
export type FilePanelSurfaceMode = "closed" | FilesSurface;

export function emptySessionFilePanelState(): SessionFilePanelState {
  return { tabs: [], activeTabId: null, filesSurface: "file" };
}

export function isFilesSurface(value: string | null | undefined): value is FilesSurface {
  return value === "explorer" || value === "file";
}

/**
 * Snapshot file tabs + last files surface for the session being left.
 * Side-chat open state is stored separately (sideChatOpenBySessionRef).
 */
export function captureSessionFilePanelState(input: {
  tabs: Tab[];
  activeTabId: string | null;
  filesSurface: FilesSurface;
  /** When side chat is showing, pass the last files surface underneath. */
  previousFilesSurface?: FilesSurface | null;
}): SessionFilePanelState {
  const filesSurface = input.previousFilesSurface && isFilesSurface(input.previousFilesSurface)
    ? input.previousFilesSurface
    : input.filesSurface;

  const activeTabId = input.activeTabId
    && input.tabs.some((tab) => tab.id === input.activeTabId)
    ? input.activeTabId
    : (input.tabs[input.tabs.length - 1]?.id ?? null);

  return {
    tabs: input.tabs.map((tab) => ({ ...tab })),
    activeTabId,
    filesSurface: filesSurface === "file" && input.tabs.length === 0 ? "file" : filesSurface,
  };
}

/** Resolve visible right-panel body when entering a session. */
export function resolveRightPanelViewOnSessionSwitch(input: {
  sideChatOpen: boolean;
  restored: SessionFilePanelState;
}): {
  open: boolean;
  surface: FilesSurface | "sideChat";
} {
  if (input.sideChatOpen) {
    return { open: true, surface: "sideChat" };
  }
  if (input.restored.filesSurface === "file" && input.restored.tabs.length === 0) {
    // No files and no side chat — keep panel closed unless explorer was explicit.
    return { open: false, surface: "file" };
  }
  if (input.restored.filesSurface === "explorer") {
    return { open: true, surface: "explorer" };
  }
  if (input.restored.tabs.length > 0) {
    return { open: true, surface: "file" };
  }
  return { open: false, surface: "file" };
}

/** New / blank composer: never carry another session's open files. */
export function blankPanelAfterLeaveSession(): {
  tabs: Tab[];
  activeTabId: string | null;
  filesSurface: FilesSurface;
  open: boolean;
  surface: FilesSurface | "sideChat";
} {
  return {
    tabs: [],
    activeTabId: null,
    filesSurface: "file",
    open: false,
    surface: "file",
  };
}

/** Derive legacy WorkspaceFilePanel mode for rendering. */
export function deriveRightPanelMode(input: {
  open: boolean;
  surface: FilesSurface | "sideChat";
}): "closed" | "explorer" | "file" | "chat" {
  if (!input.open) return "closed";
  if (input.surface === "sideChat") return "chat";
  return input.surface;
}
