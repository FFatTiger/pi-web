/**
 * Codex-style right panel multi-tab model.
 * - sideChat: one side-chat tab
 * - files: explorer shell (no specific file)
 * - file: one top-level chip per open file (Codex open-file tabs)
 */

export type RightPanelTabKind = "sideChat" | "files" | "file";

export type RightPanelTab = {
  id: string;
  kind: RightPanelTabKind;
  /** Display label (file name / side chat title). */
  title?: string;
  /** Absolute path when kind === "file". */
  filePath?: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "source" | "preview" | "diff";
};

/** Actions shown in empty state / + menu. */
export type RightPanelTabAction = "files" | "sideChat";

export function tabIdForKind(kind: Exclude<RightPanelTabKind, "file">): string {
  return `rp:${kind}`;
}

export function tabIdForFile(filePath: string): string {
  return `file:${filePath}`;
}

export function createRightPanelTab(
  kind: Exclude<RightPanelTabKind, "file">,
  title?: string,
): RightPanelTab {
  return { id: tabIdForKind(kind), kind, title };
}

export function createFilePanelTab(input: {
  filePath: string;
  fileName: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "source" | "preview" | "diff";
}): RightPanelTab {
  return {
    id: tabIdForFile(input.filePath),
    kind: "file",
    title: input.fileName,
    filePath: input.filePath,
    sourceSessionId: input.sourceSessionId,
    initialDisplayMode: input.initialDisplayMode,
  };
}

export function emptyRightPanelTabs(): {
  tabs: RightPanelTab[];
  activeTabId: string | null;
} {
  return { tabs: [], activeTabId: null };
}

export function findTabByKind(
  tabs: RightPanelTab[],
  kind: Exclude<RightPanelTabKind, "file">,
): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === kind) ?? null;
}

export function findFileTab(tabs: RightPanelTab[], filePath: string): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === "file" && tab.filePath === filePath) ?? null;
}

export function listFileTabs(tabs: RightPanelTab[]): RightPanelTab[] {
  return tabs.filter((tab) => tab.kind === "file" && Boolean(tab.filePath));
}

/**
 * Open or focus a non-file tab (sideChat / files shell).
 */
export function openOrFocusRightPanelTab(
  tabs: RightPanelTab[],
  kind: Exclude<RightPanelTabKind, "file">,
  title?: string | null,
): { tabs: RightPanelTab[]; activeTabId: string } {
  const existing = findTabByKind(tabs, kind);
  if (existing) {
    let nextTabs = tabs;
    if (title !== undefined) {
      const nextTitle = title === null ? undefined : title;
      if (nextTitle !== existing.title) {
        nextTabs = tabs.map((tab) => (
          tab.id === existing.id ? { ...tab, title: nextTitle } : tab
        ));
      }
    }
    return { tabs: nextTabs, activeTabId: existing.id };
  }
  const tab = createRightPanelTab(kind, title === null ? undefined : title);
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

/**
 * Open or focus a file as its own top-level panel tab (Codex multi open files).
 */
export function openOrFocusFilePanelTab(
  tabs: RightPanelTab[],
  input: {
    filePath: string;
    fileName: string;
    sourceSessionId?: string | null;
    initialDisplayMode?: "source" | "preview" | "diff";
  },
): { tabs: RightPanelTab[]; activeTabId: string } {
  const existing = findFileTab(tabs, input.filePath);
  if (existing) {
    const nextTabs = tabs.map((tab) => {
      if (tab.id !== existing.id) return tab;
      return {
        ...tab,
        title: input.fileName,
        sourceSessionId: input.sourceSessionId ?? tab.sourceSessionId,
        initialDisplayMode: input.initialDisplayMode ?? tab.initialDisplayMode,
      };
    });
    return { tabs: nextTabs, activeTabId: existing.id };
  }
  // Drop empty explorer shell when the first real file opens.
  const withoutEmptyFilesShell = tabs.filter((tab) => tab.kind !== "files");
  const tab = createFilePanelTab(input);
  return { tabs: [...withoutEmptyFilesShell, tab], activeTabId: tab.id };
}

export function updateRightPanelTabTitle(
  tabs: RightPanelTab[],
  kind: Exclude<RightPanelTabKind, "file">,
  title: string | null | undefined,
): RightPanelTab[] {
  const existing = findTabByKind(tabs, kind);
  if (!existing) return tabs;
  const nextTitle = title === null || title === undefined ? undefined : title;
  if (existing.title === nextTitle) return tabs;
  return tabs.map((tab) => (tab.id === existing.id ? { ...tab, title: nextTitle } : tab));
}

/**
 * Close a tab. Returns empty active when last tab closes (Codex empty state).
 */
export function closeRightPanelTab(
  tabs: RightPanelTab[],
  activeTabId: string | null,
  tabId: string,
): { tabs: RightPanelTab[]; activeTabId: string | null } {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs, activeTabId };
  const next = tabs.filter((tab) => tab.id !== tabId);
  if (next.length === 0) return { tabs: [], activeTabId: null };
  if (activeTabId !== tabId) {
    return { tabs: next, activeTabId };
  }
  const fallback = next[Math.min(index, next.length - 1)] ?? next[next.length - 1];
  return { tabs: next, activeTabId: fallback.id };
}

export type RightPanelMenuItem = {
  id: RightPanelTabAction;
  enabled: boolean;
  shortcut?: string;
  available: boolean;
};

/**
 * Empty-state / + menu: only Files + Side chat for current product scope.
 */
export function buildRightPanelMenuItems(input: {
  hasWorkspace: boolean;
  hasSession: boolean;
}): RightPanelMenuItem[] {
  return [
    {
      id: "files",
      enabled: input.hasWorkspace,
      available: true,
      shortcut: "Ctrl+P",
    },
    {
      id: "sideChat",
      enabled: input.hasSession,
      available: true,
      shortcut: "Ctrl+Alt+S",
    },
  ];
}

export function actionToTabKind(action: RightPanelTabAction): Exclude<RightPanelTabKind, "file"> {
  return action;
}
