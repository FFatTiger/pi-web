/**
 * Codex-style right panel multi-tab model (files + side chat only for now).
 * See docs/codex-right-panel-ia.md.
 */

export type RightPanelTabKind = "sideChat" | "files";

export type RightPanelTab = {
  id: string;
  kind: RightPanelTabKind;
  /** Display label override (e.g. current open file name). */
  title?: string;
};

/** Actions shown in empty state / + menu. */
export type RightPanelTabAction = "files" | "sideChat";

export function tabIdForKind(kind: RightPanelTabKind): string {
  return `rp:${kind}`;
}

export function createRightPanelTab(kind: RightPanelTabKind, title?: string): RightPanelTab {
  return { id: tabIdForKind(kind), kind, title };
}

export function emptyRightPanelTabs(): {
  tabs: RightPanelTab[];
  activeTabId: string | null;
} {
  return { tabs: [], activeTabId: null };
}

export function findTabByKind(tabs: RightPanelTab[], kind: RightPanelTabKind): RightPanelTab | null {
  return tabs.find((tab) => tab.kind === kind) ?? null;
}

/**
 * Open or focus a tab of the given kind (Codex openTab: activate existing or append).
 * Pass `title` to update the chip label (e.g. open file name).
 * Pass `title: null` to clear an override.
 */
export function openOrFocusRightPanelTab(
  tabs: RightPanelTab[],
  kind: RightPanelTabKind,
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

export function updateRightPanelTabTitle(
  tabs: RightPanelTab[],
  kind: RightPanelTabKind,
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
  hasFilesTab?: boolean;
  hasSideChatTab?: boolean;
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

export function actionToTabKind(action: RightPanelTabAction): RightPanelTabKind {
  return action;
}
