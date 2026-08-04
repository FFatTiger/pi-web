/**
 * Codex-style right panel multi-tab model.
 * See docs/codex-right-panel-ia.md (extracted from thread-app-shell-chrome).
 */

export type RightPanelTabKind = "sideChat" | "files" | "review";

export type RightPanelTab = {
  id: string;
  kind: RightPanelTabKind;
  /** Optional display override (e.g. open file name). */
  title?: string;
};

export type RightPanelTabAction = "review" | "terminal" | "browser" | "files" | "sideChat";

/** Codex git sort order for known actions; others keep insertion order. */
const ACTION_SORT: Record<string, number> = {
  review: 0,
  terminal: 1,
  browser: 2,
  files: 3,
  sideChat: 4,
};

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
 */
export function openOrFocusRightPanelTab(
  tabs: RightPanelTab[],
  kind: RightPanelTabKind,
  title?: string,
): { tabs: RightPanelTab[]; activeTabId: string } {
  const existing = findTabByKind(tabs, kind);
  if (existing) {
    const nextTabs = title && title !== existing.title
      ? tabs.map((tab) => (tab.id === existing.id ? { ...tab, title } : tab))
      : tabs;
    return { tabs: nextTabs, activeTabId: existing.id };
  }
  const tab = createRightPanelTab(kind, title);
  return { tabs: [...tabs, tab], activeTabId: tab.id };
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
  /** Codex keysLabel — display only */
  shortcut?: string;
  /** Whether this action can create a real tab in pi-web today */
  available: boolean;
};

/**
 * Codex empty-state / + menu actions with git-style order.
 * Terminal & Browser stay listed but unavailable until capabilities exist.
 */
export function buildRightPanelMenuItems(input: {
  hasWorkspace: boolean;
  hasSession: boolean;
  hasFilesTab?: boolean;
  hasSideChatTab?: boolean;
  hasReviewTab?: boolean;
}): RightPanelMenuItem[] {
  const items: RightPanelMenuItem[] = [
    {
      id: "review",
      enabled: !input.hasReviewTab,
      available: true,
      shortcut: "Ctrl+Shift+G",
    },
    {
      id: "terminal",
      enabled: false,
      available: false,
    },
    {
      id: "browser",
      enabled: false,
      available: false,
      shortcut: "Ctrl+T",
    },
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

  return items.sort((a, b) => (ACTION_SORT[a.id] ?? 99) - (ACTION_SORT[b.id] ?? 99));
}

export function actionToTabKind(action: RightPanelTabAction): RightPanelTabKind | null {
  if (action === "review") return "review";
  if (action === "files") return "files";
  if (action === "sideChat") return "sideChat";
  return null;
}
