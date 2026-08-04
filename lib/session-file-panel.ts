import type { Tab } from "@/components/TabBar";

/**
 * Conversation-scoped open file tabs inside the right-panel Files tab.
 * Panel shell tabs (sideChat / files) live in right-panel-tabs.ts.
 */
export type SessionFilePanelState = {
  tabs: Tab[];
  activeTabId: string | null;
};

export function emptySessionFilePanelState(): SessionFilePanelState {
  return { tabs: [], activeTabId: null };
}

export function captureSessionFilePanelState(input: {
  tabs: Tab[];
  activeTabId: string | null;
}): SessionFilePanelState {
  const activeTabId = input.activeTabId
    && input.tabs.some((tab) => tab.id === input.activeTabId)
    ? input.activeTabId
    : (input.tabs[input.tabs.length - 1]?.id ?? null);

  return {
    tabs: input.tabs.map((tab) => ({ ...tab })),
    activeTabId,
  };
}

/** New / blank composer: never carry another session's open files. */
export function blankPanelAfterLeaveSession(): SessionFilePanelState {
  return emptySessionFilePanelState();
}
