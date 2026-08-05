/**
 * Codex-style right panel multi-tab model.
 * - sideChat: one tab per side session (`sidechat:{id}`)
 * - files: explorer shell (no specific file)
 * - file: one top-level chip per open file
 */

export type RightPanelTabKind = "sideChat" | "files" | "file";

/** Keep sidechat tab ids stable without importing side-chat-metadata into unit tests. */
export function tabIdForSideChat(sideSessionId: string): string {
  return `sidechat:${sideSessionId}`;
}

export type RightPanelTab = {
  id: string;
  kind: RightPanelTabKind;
  /** Display label (file name / side chat title). */
  title?: string;
  /** Absolute path when kind === "file". */
  filePath?: string;
  /** Side session id when kind === "sideChat". */
  sideSessionId?: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "source" | "preview" | "diff";
};

/** Actions shown in empty state / + menu. */
export type RightPanelTabAction = "files" | "sideChat";

export function tabIdForKind(kind: Exclude<RightPanelTabKind, "file" | "sideChat">): string {
  return `rp:${kind}`;
}

export function tabIdForFile(filePath: string): string {
  return `file:${filePath}`;
}

export function createRightPanelTab(
  kind: Exclude<RightPanelTabKind, "file" | "sideChat">,
  title?: string,
): RightPanelTab {
  return { id: tabIdForKind(kind), kind, title };
}

export function createSideChatPanelTab(input: {
  sideSessionId: string;
  title?: string | null;
}): RightPanelTab {
  return {
    id: tabIdForSideChat(input.sideSessionId),
    kind: "sideChat",
    sideSessionId: input.sideSessionId,
    title: input.title ?? undefined,
  };
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
  kind: Exclude<RightPanelTabKind, "file" | "sideChat">,
): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === kind) ?? null;
}

export function findSideChatTab(tabs: RightPanelTab[], sideSessionId: string): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === "sideChat" && tab.sideSessionId === sideSessionId) ?? null;
}

export function listSideChatTabs(tabs: RightPanelTab[]): RightPanelTab[] {
  return tabs.filter((tab) => tab.kind === "sideChat" && Boolean(tab.sideSessionId));
}

export function findFileTab(tabs: RightPanelTab[], filePath: string): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === "file" && tab.filePath === filePath) ?? null;
}

export function listFileTabs(tabs: RightPanelTab[]): RightPanelTab[] {
  return tabs.filter((tab) => tab.kind === "file" && Boolean(tab.filePath));
}

/**
 * Open or focus a non-file, non-sidechat tab (files shell).
 */
export function openOrFocusRightPanelTab(
  tabs: RightPanelTab[],
  kind: Exclude<RightPanelTabKind, "file" | "sideChat">,
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
 * Open or focus a side chat tab. Always creates a new chip when `forceNew`.
 */
export function openOrFocusSideChatPanelTab(
  tabs: RightPanelTab[],
  input: {
    sideSessionId: string;
    title?: string | null;
    forceNew?: boolean;
  },
): { tabs: RightPanelTab[]; activeTabId: string } {
  if (!input.forceNew) {
    const existing = findSideChatTab(tabs, input.sideSessionId);
    if (existing) {
      let nextTabs = tabs;
      if (input.title !== undefined) {
        const nextTitle = input.title === null ? undefined : input.title;
        if (nextTitle !== existing.title) {
          nextTabs = tabs.map((tab) => (
            tab.id === existing.id ? { ...tab, title: nextTitle } : tab
          ));
        }
      }
      return { tabs: nextTabs, activeTabId: existing.id };
    }
  }
  // Replace any stale tab that already used this id (refork/clear swap).
  const withoutSameId = tabs.filter((tab) => tab.id !== tabIdForSideChat(input.sideSessionId));
  const tab = createSideChatPanelTab(input);
  return { tabs: [...withoutSameId, tab], activeTabId: tab.id };
}

/**
 * Replace a side chat tab id (refork/clear creates a new session).
 */
export function replaceSideChatPanelTab(
  tabs: RightPanelTab[],
  previousSideSessionId: string | null | undefined,
  next: { sideSessionId: string; title?: string | null },
): { tabs: RightPanelTab[]; activeTabId: string } {
  const nextTab = createSideChatPanelTab(next);
  if (!previousSideSessionId) {
    return { tabs: [...tabs, nextTab], activeTabId: nextTab.id };
  }
  const index = tabs.findIndex(
    (tab) => tab.kind === "sideChat" && tab.sideSessionId === previousSideSessionId,
  );
  if (index < 0) {
    return { tabs: [...tabs, nextTab], activeTabId: nextTab.id };
  }
  const nextTabs = tabs.slice();
  nextTabs[index] = nextTab;
  return { tabs: nextTabs, activeTabId: nextTab.id };
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
  tabId: string,
  title: string | null | undefined,
): RightPanelTab[] {
  const existing = tabs.find((tab) => tab.id === tabId);
  if (!existing) return tabs;
  const nextTitle = title === null || title === undefined ? undefined : title;
  if (existing.title === nextTitle) return tabs;
  return tabs.map((tab) => (tab.id === tabId ? { ...tab, title: nextTitle } : tab));
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
 * Side chat always opens a new ephemeral conversation (Codex behavior).
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
