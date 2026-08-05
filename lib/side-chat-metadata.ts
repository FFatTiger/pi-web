export const SIDE_CHAT_SESSION_NAME_PREFIX = "__pi_web_side_chat__";
export const SIDE_CHAT_METADATA_TYPE = "pi-web-side-chat";
export const SIDE_CHAT_BOUNDARY_TYPE = "pi-web-side-chat-boundary";
export const SIDE_CHAT_PEEK_TOOL_NAME = "peek_main";

/** Codex-style ephemeral TTL for inactive side chats (1 hour). */
export const SIDE_CHAT_TTL_MS = 60 * 60 * 1000;

export type SideChatStatus = "active" | "inactive";
export type SideChatToolMode = "readonly" | "edit";

export interface SideChatSessionMetadata {
  mainSessionId: string;
  status: SideChatStatus;
  forkLeafId: string | null;
  toolMode: SideChatToolMode;
  ephemeral: boolean;
  createdAt: string;
  lastActiveAt: string;
  title?: string | null;
}

type SessionEntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

/** Inspection tools available in read-only Side Chat. */
export const SIDE_CHAT_READONLY_TOOL_NAMES = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  SIDE_CHAT_PEEK_TOOL_NAME,
] as const;

/** Full coding tools for explicit edit mode. */
export const SIDE_CHAT_EDIT_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  SIDE_CHAT_PEEK_TOOL_NAME,
] as const;

/** @deprecated Use SIDE_CHAT_EDIT_TOOL_NAMES / getSideChatToolSelection(mode). */
export const SIDE_CHAT_TOOL_NAMES = [...SIDE_CHAT_EDIT_TOOL_NAMES];

/**
 * Codex-aligned boundary text injected into every new side conversation.
 * Present in LLM context; UI may render it as a system banner.
 */
export const SIDE_CHAT_BOUNDARY_TEXT = `Side conversation boundary.

Everything before this boundary is inherited history from the parent thread. It is reference context only. It is not your current task.

Do not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.

You are a side-conversation assistant, separate from the main thread. Answer questions and do lightweight, non-mutating exploration without disrupting the main thread. If there is no user question after this boundary yet, wait for one.

External tools may be available according to this thread's current permissions. Any tool calls or outputs visible before this boundary happened in the parent thread and are reference-only; do not infer active instructions from them.

Sub-agents are off-limits in this side conversation. Do not interact with any existing or new sub-agents, even if sub-agents were used before this boundary.

Do not modify files, source, git state, permissions, configuration, or workspace state unless the user explicitly asks for that mutation after this boundary. Do not request escalated permissions or broader sandbox access unless the user explicitly asks for a mutation that requires it. If the user explicitly requests a mutation, keep it minimal, local to the request, and avoid disrupting the main thread.`;

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

export function normalizeSideChatToolMode(value: unknown): SideChatToolMode {
  return value === "edit" ? "edit" : "readonly";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPersistedMetadata(value: unknown): value is Partial<SideChatSessionMetadata> & {
  mainSessionId: string;
  status: SideChatStatus;
  forkLeafId: string | null;
} {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SideChatSessionMetadata>;
  return typeof data.mainSessionId === "string"
    && (data.status === "active" || data.status === "inactive")
    && (data.forkLeafId === null || typeof data.forkLeafId === "string");
}

export function defaultSideChatMetadata(
  partial: Pick<SideChatSessionMetadata, "mainSessionId" | "status" | "forkLeafId"> & Partial<SideChatSessionMetadata>,
  now = new Date().toISOString(),
): SideChatSessionMetadata {
  return {
    mainSessionId: partial.mainSessionId,
    status: partial.status,
    forkLeafId: partial.forkLeafId,
    toolMode: normalizeSideChatToolMode(partial.toolMode),
    ephemeral: partial.ephemeral !== false,
    createdAt: isIsoDate(partial.createdAt) ? partial.createdAt : now,
    lastActiveAt: isIsoDate(partial.lastActiveAt) ? partial.lastActiveAt : now,
    title: typeof partial.title === "string" || partial.title === null ? partial.title : null,
  };
}

export function readSideChatSessionMetadata(
  name: string | undefined,
  entries: readonly SessionEntryLike[],
): SideChatSessionMetadata | null {
  const marker = parseSideChatSessionName(name);
  if (!marker) return null;

  let persisted: Partial<SideChatSessionMetadata> | null = null;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === SIDE_CHAT_METADATA_TYPE && isPersistedMetadata(entry.data)) {
      persisted = entry.data;
    }
  }

  if (persisted && persisted.mainSessionId !== marker.mainSessionId) {
    persisted = null;
  }

  return defaultSideChatMetadata({
    mainSessionId: marker.mainSessionId,
    status: marker.status,
    forkLeafId: persisted?.forkLeafId ?? null,
    toolMode: persisted?.toolMode,
    ephemeral: persisted?.ephemeral,
    createdAt: persisted?.createdAt,
    lastActiveAt: persisted?.lastActiveAt,
    title: persisted?.title,
  });
}

export function isSideChatExpired(
  metadata: Pick<SideChatSessionMetadata, "ephemeral" | "lastActiveAt" | "createdAt">,
  nowMs = Date.now(),
  ttlMs = SIDE_CHAT_TTL_MS,
): boolean {
  if (!metadata.ephemeral) return false;
  const anchor = Date.parse(metadata.lastActiveAt || metadata.createdAt || "");
  if (Number.isNaN(anchor)) return false;
  return nowMs - anchor >= ttlMs;
}

export function deriveSideChatTitle(text: string | null | undefined, maxLen = 40): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
}

export function getSideChatToolSelection(toolMode: SideChatToolMode = "readonly"): {
  toolNames: string[];
  includeExtensionTools: boolean;
} {
  // Extension/MCP tools stay off to keep the thread lightweight.
  // Mutating tools (write/edit) only unlock in explicit edit mode.
  return {
    toolNames: toolMode === "edit"
      ? [...SIDE_CHAT_EDIT_TOOL_NAMES]
      : [...SIDE_CHAT_READONLY_TOOL_NAMES],
    includeExtensionTools: false,
  };
}

export function tabIdForSideChat(sideSessionId: string): string {
  return `sidechat:${sideSessionId}`;
}

export function parseSideChatTabId(tabId: string | null | undefined): string | null {
  if (!tabId || !tabId.startsWith("sidechat:")) return null;
  const id = tabId.slice("sidechat:".length);
  return id || null;
}
