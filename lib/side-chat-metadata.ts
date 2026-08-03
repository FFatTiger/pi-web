export const SIDE_CHAT_SESSION_NAME_PREFIX = "__pi_web_side_chat__";
export const SIDE_CHAT_METADATA_TYPE = "pi-web-side-chat";
export const SIDE_CHAT_PEEK_TOOL_NAME = "peek_main";

export type SideChatToolMode = "readonly" | "edit";
export type SideChatStatus = "active" | "inactive";

export interface SideChatSessionMetadata {
  mainSessionId: string;
  status: SideChatStatus;
  toolMode: SideChatToolMode;
  forkLeafId: string | null;
}

type SessionEntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

export const SIDE_CHAT_READONLY_TOOL_NAMES = ["read", "grep", "find", "ls", SIDE_CHAT_PEEK_TOOL_NAME];
export const SIDE_CHAT_EDIT_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export function formatSideChatSessionName(metadata: Pick<SideChatSessionMetadata, "mainSessionId" | "status" | "toolMode">): string {
  return [
    SIDE_CHAT_SESSION_NAME_PREFIX,
    encodeURIComponent(metadata.mainSessionId),
    metadata.status,
    metadata.toolMode,
  ].join(":");
}

export function parseSideChatSessionName(name?: string): Omit<SideChatSessionMetadata, "forkLeafId"> | null {
  if (!name) return null;
  const [prefix, encodedMainSessionId, status, toolMode, ...extra] = name.split(":");
  if (
    prefix !== SIDE_CHAT_SESSION_NAME_PREFIX ||
    !encodedMainSessionId ||
    extra.length > 0 ||
    (status !== "active" && status !== "inactive") ||
    (toolMode !== "readonly" && toolMode !== "edit")
  ) {
    return null;
  }

  try {
    const mainSessionId = decodeURIComponent(encodedMainSessionId);
    return mainSessionId ? { mainSessionId, status, toolMode } : null;
  } catch {
    return null;
  }
}

export function isSideChatSessionName(name?: string): boolean {
  return parseSideChatSessionName(name) !== null;
}

function isPersistedMetadata(value: unknown): value is SideChatSessionMetadata {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SideChatSessionMetadata>;
  return typeof data.mainSessionId === "string"
    && (data.status === "active" || data.status === "inactive")
    && (data.toolMode === "readonly" || data.toolMode === "edit")
    && (data.forkLeafId === null || typeof data.forkLeafId === "string");
}

export function readSideChatSessionMetadata(
  name: string | undefined,
  entries: readonly SessionEntryLike[],
): SideChatSessionMetadata | null {
  const marker = parseSideChatSessionName(name);
  if (!marker) return null;

  let persisted: SideChatSessionMetadata | null = null;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === SIDE_CHAT_METADATA_TYPE && isPersistedMetadata(entry.data)) {
      persisted = entry.data;
    }
  }

  return {
    ...marker,
    forkLeafId: persisted?.mainSessionId === marker.mainSessionId ? persisted.forkLeafId : null,
  };
}

export function getSideChatToolSelection(toolMode?: SideChatToolMode): {
  toolNames: string[];
  includeExtensionTools: boolean;
} {
  void toolMode;
  // Side Chat always gets the full default tool set. Codex-style safety is
  // enforced by the side-conversation system prompt (mutate only when asked),
  // not by a readonly/edit UI mode.
  return {
    toolNames: [...SIDE_CHAT_EDIT_TOOL_NAMES, SIDE_CHAT_PEEK_TOOL_NAME],
    includeExtensionTools: true,
  };
}
