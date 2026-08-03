export const SIDE_CHAT_SESSION_NAME_PREFIX = "__pi_web_side_chat__";
export const SIDE_CHAT_METADATA_TYPE = "pi-web-side-chat";
export const SIDE_CHAT_PEEK_TOOL_NAME = "peek_main";

export type SideChatStatus = "active" | "inactive";

export interface SideChatSessionMetadata {
  mainSessionId: string;
  status: SideChatStatus;
  forkLeafId: string | null;
}

type SessionEntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

/** Built-in tools available in Side Chat. Extension/MCP tools are intentionally excluded. */
export const SIDE_CHAT_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  SIDE_CHAT_PEEK_TOOL_NAME,
];

export function formatSideChatSessionName(
  metadata: Pick<SideChatSessionMetadata, "mainSessionId" | "status">,
): string {
  return [
    SIDE_CHAT_SESSION_NAME_PREFIX,
    encodeURIComponent(metadata.mainSessionId),
    metadata.status,
  ].join(":");
}

export function parseSideChatSessionName(
  name?: string,
): Pick<SideChatSessionMetadata, "mainSessionId" | "status"> | null {
  if (!name) return null;
  const parts = name.split(":");
  if (parts[0] !== SIDE_CHAT_SESSION_NAME_PREFIX) return null;

  // Current: prefix:encodedId:status
  // Legacy:  prefix:encodedId:status:readonly|edit
  if (parts.length !== 3 && parts.length !== 4) return null;
  const encodedMainSessionId = parts[1];
  const status = parts[2];
  if (!encodedMainSessionId || (status !== "active" && status !== "inactive")) return null;
  if (parts.length === 4 && parts[3] !== "readonly" && parts[3] !== "edit") return null;

  try {
    const mainSessionId = decodeURIComponent(encodedMainSessionId);
    return mainSessionId ? { mainSessionId, status } : null;
  } catch {
    return null;
  }
}

export function isSideChatSessionName(name?: string): boolean {
  return parseSideChatSessionName(name) !== null;
}

function isPersistedMetadata(value: unknown): value is SideChatSessionMetadata {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SideChatSessionMetadata> & { toolMode?: unknown };
  // Tolerate legacy toolMode field on disk; ignore it.
  return typeof data.mainSessionId === "string"
    && (data.status === "active" || data.status === "inactive")
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
      persisted = {
        mainSessionId: entry.data.mainSessionId,
        status: entry.data.status,
        forkLeafId: entry.data.forkLeafId,
      };
    }
  }

  return {
    ...marker,
    forkLeafId: persisted?.mainSessionId === marker.mainSessionId ? persisted.forkLeafId : null,
  };
}

export function getSideChatToolSelection(): {
  toolNames: string[];
  includeExtensionTools: boolean;
} {
  // Side Chat gets built-in coding tools + peek_main only.
  // Codex-style safety is enforced by the side-conversation system prompt
  // (mutate only when asked). Extension/MCP tools stay off to keep the
  // thread lightweight and free of external tool noise.
  return {
    toolNames: [...SIDE_CHAT_TOOL_NAMES],
    includeExtensionTools: false,
  };
}
