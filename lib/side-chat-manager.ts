import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync } from "fs";
import { cacheSessionPath, invalidateSessionListCache, resolveSessionPath } from "./session-reader";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import {
  SIDE_CHAT_BOUNDARY_TEXT,
  SIDE_CHAT_BOUNDARY_TYPE,
  SIDE_CHAT_METADATA_TYPE,
  defaultSideChatMetadata,
  deriveSideChatTitle,
  formatSideChatSessionName,
  getSideChatToolSelection,
  isSideChatExpired,
  normalizeSideChatToolMode,
  parseSideChatSessionName,
  readSideChatSessionMetadata,
  type SideChatSessionMetadata,
  type SideChatToolMode,
} from "./side-chat-metadata";
import type { SessionInfo } from "./types";

export type SideChatAction =
  | "open"
  | "create"
  | "refork"
  | "clear"
  | "set_mode"
  | "touch"
  | "send";

export interface SideChatResult {
  session: SessionInfo;
  metadata: SideChatSessionMetadata;
  expired: boolean;
  created: boolean;
}

export interface OpenSideChatOptions {
  action: SideChatAction;
  mainSessionId: string;
  /** Target an existing side session (required for refork/clear/set_mode/touch on multi-tab). */
  sideSessionId?: string;
  toolMode?: SideChatToolMode;
  /** Optional first user message (composer → side chat). */
  message?: string;
  /** Prefer creating a new side chat even when actives exist (default for create). */
  forceNew?: boolean;
}

declare global {
  var __piSideChatLocks: Map<string, Promise<unknown>> | undefined;
}

function getSideChatLocks(): Map<string, Promise<unknown>> {
  if (!globalThis.__piSideChatLocks) globalThis.__piSideChatLocks = new Map();
  return globalThis.__piSideChatLocks;
}

async function withMainSessionLock<T>(mainSessionId: string, operation: () => Promise<T>): Promise<T> {
  const locks = getSideChatLocks();
  const previous = locks.get(mainSessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  locks.set(mainSessionId, queued);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(mainSessionId) === queued) locks.delete(mainSessionId);
  }
}

function toClientSessionInfo(info: PiSessionInfo): SessionInfo {
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    name: info.name,
    created: info.created instanceof Date ? info.created.toISOString() : String(info.created),
    modified: info.modified instanceof Date ? info.modified.toISOString() : String(info.modified),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage || "(no messages)",
    projectRoot: info.cwd,
  };
}

function readMetadataFromInfo(info: PiSessionInfo): SideChatSessionMetadata | null {
  try {
    const manager = SessionManager.open(info.path);
    return readSideChatSessionMetadata(info.name, manager.getEntries());
  } catch {
    return parseSideChatSessionName(info.name)
      ? defaultSideChatMetadata({
        mainSessionId: parseSideChatSessionName(info.name)!.mainSessionId,
        status: parseSideChatSessionName(info.name)!.status,
        forkLeafId: null,
      })
      : null;
  }
}

async function listSideChats(mainSessionId: string): Promise<PiSessionInfo[]> {
  const sessions = await SessionManager.listAll();
  return sessions
    .filter((session) => {
      const marker = parseSideChatSessionName(session.name);
      return marker?.mainSessionId === mainSessionId;
    })
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

function listActiveSideChats(all: PiSessionInfo[]): PiSessionInfo[] {
  return all.filter((session) => parseSideChatSessionName(session.name)?.status === "active");
}

async function getPiSessionInfo(filePath: string): Promise<PiSessionInfo> {
  const sessions = await SessionManager.listAll();
  const info = sessions.find((session) => session.path === filePath);
  if (!info) throw new Error("Created Side Chat session was not found");
  return info;
}

function appendMetadata(manager: SessionManager, metadata: SideChatSessionMetadata): void {
  manager.appendCustomEntry(SIDE_CHAT_METADATA_TYPE, metadata);
  manager.appendSessionInfo(formatSideChatSessionName(metadata));
}

function ensureSessionPersisted(manager: SessionManager): void {
  const filePath = manager.getSessionFile();
  if (!filePath || existsSync(filePath)) return;
  const header = manager.getHeader();
  if (!header) throw new Error("Side Chat session header is missing");

  const contents = [header, ...manager.getEntries()]
    .map((entry) => JSON.stringify(entry))
    .join("\n") + "\n";
  writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx" });
  // Pi normally delays the first flush until an assistant message exists.
  // Empty Clear / boundary-only sessions must be discoverable before first prompt.
  (manager as unknown as { flushed: boolean }).flushed = true;
}

async function abortSideSession(info: PiSessionInfo | undefined): Promise<void> {
  if (!info) return;
  const wrapper = getRpcSession(info.id);
  if (!wrapper) return;
  if (wrapper.inner.isBashRunning) {
    await wrapper.send({ type: "abort_bash" });
  }
  if (wrapper.inner.isCompacting) {
    await wrapper.send({ type: "abort_compaction" });
  }
  if (wrapper.isRunning()) {
    await wrapper.send({ type: "abort" });
  }
}

async function markInactive(info: PiSessionInfo): Promise<void> {
  const mainSessionId = parseSideChatSessionName(info.name)?.mainSessionId;
  if (!mainSessionId) return;
  const name = formatSideChatSessionName({
    mainSessionId,
    status: "inactive",
  });
  const wrapper = getRpcSession(info.id);
  if (wrapper?.isAlive()) {
    await wrapper.send({ type: "set_session_name", name });
  } else {
    SessionManager.open(info.path).appendSessionInfo(name);
  }

  // Keep custom metadata status in sync for expiry / listing.
  try {
    const manager = SessionManager.open(info.path);
    const current = readSideChatSessionMetadata(info.name, manager.getEntries());
    if (current) {
      appendMetadata(manager, {
        ...current,
        status: "inactive",
        lastActiveAt: new Date().toISOString(),
      });
    }
  } catch {
    // best-effort
  }
}

function getSessionPreferences(manager: SessionManager): {
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
} {
  const context = manager.buildSessionContext();
  return {
    ...(context.model ? { initialModel: context.model } : {}),
    ...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel as ThinkingLevel } : {}),
  };
}

function injectBoundary(manager: SessionManager): void {
  manager.appendCustomMessageEntry(
    SIDE_CHAT_BOUNDARY_TYPE,
    SIDE_CHAT_BOUNDARY_TEXT,
    true,
    { kind: "side-conversation-boundary" },
  );
}

async function createSideChatSession(
  mainSessionId: string,
  mainCwd: string,
  mainSessionDir: string,
  mainSessionPath: string,
  activityLeafId: string | null,
  preferences: ReturnType<typeof getSessionPreferences>,
  toolMode: SideChatToolMode,
  title?: string | null,
): Promise<{ info: PiSessionInfo; metadata: SideChatSessionMetadata }> {
  // Codex-style: do NOT copy parent turns. Start empty and inject a boundary.
  // Main progress is observed via peek_main; files via read tools.
  const manager = SessionManager.create(mainCwd, mainSessionDir, { parentSession: mainSessionPath });
  const now = new Date().toISOString();
  const metadata = defaultSideChatMetadata({
    mainSessionId,
    status: "active",
    forkLeafId: activityLeafId,
    toolMode,
    ephemeral: true,
    createdAt: now,
    lastActiveAt: now,
    title: title ?? null,
  });
  appendMetadata(manager, metadata);
  injectBoundary(manager);
  ensureSessionPersisted(manager);

  const filePath = manager.getSessionFile();
  if (!filePath) throw new Error("Side Chat session is not persisted");
  const sessionId = manager.getSessionId();
  cacheSessionPath(sessionId, filePath);
  invalidateSessionListCache();

  const toolSelection = getSideChatToolSelection(toolMode);
  await startRpcSession(sessionId, filePath, undefined, {
    ...preferences,
    persistInitialPreferences: false,
    toolNames: toolSelection.toolNames,
    includeExtensionTools: toolSelection.includeExtensionTools,
  });
  return { info: await getPiSessionInfo(filePath), metadata };
}

async function warmSideSession(
  info: PiSessionInfo,
  metadata: SideChatSessionMetadata,
): Promise<void> {
  cacheSessionPath(info.id, info.path);
  const toolSelection = getSideChatToolSelection(metadata.toolMode);
  await startRpcSession(info.id, info.path, undefined, {
    persistInitialPreferences: false,
    toolNames: toolSelection.toolNames,
    includeExtensionTools: toolSelection.includeExtensionTools,
  });
}

async function touchMetadata(info: PiSessionInfo, patch: Partial<SideChatSessionMetadata> = {}): Promise<SideChatSessionMetadata> {
  const manager = SessionManager.open(info.path);
  const current = readSideChatSessionMetadata(info.name, manager.getEntries())
    ?? defaultSideChatMetadata({
      mainSessionId: parseSideChatSessionName(info.name)?.mainSessionId ?? "unknown",
      status: "active",
      forkLeafId: null,
    });
  const next: SideChatSessionMetadata = {
    ...current,
    ...patch,
    toolMode: normalizeSideChatToolMode(patch.toolMode ?? current.toolMode),
    lastActiveAt: new Date().toISOString(),
    status: "active",
  };
  appendMetadata(manager, next);
  return next;
}

async function resolveSideSessionWrapper(
  info: PiSessionInfo,
  options: Parameters<typeof startRpcSession>[3] = {},
) {
  const existing = getRpcSession(info.id);
  if (existing) return existing;
  const started = await startRpcSession(info.id, info.path, undefined, {
    persistInitialPreferences: false,
    ...options,
  });
  return started.session;
}

async function applyToolMode(info: PiSessionInfo, toolMode: SideChatToolMode): Promise<SideChatSessionMetadata> {
  const metadata = await touchMetadata(info, { toolMode });
  const selection = getSideChatToolSelection(toolMode);
  const wrapper = await resolveSideSessionWrapper(info, {
    toolNames: selection.toolNames,
    includeExtensionTools: selection.includeExtensionTools,
  });
  await wrapper.send({
    type: "set_tools",
    toolNames: selection.toolNames,
    includeExtensionTools: selection.includeExtensionTools,
  });
  return metadata;
}

async function sendMessageToSide(info: PiSessionInfo, message: string): Promise<void> {
  const text = message.trim();
  if (!text) return;
  const wrapper = await resolveSideSessionWrapper(info);
  await wrapper.send({ type: "prompt", message: text });
  await touchMetadata(info, {
    title: deriveSideChatTitle(text) ?? undefined,
  });
}

function toResult(
  info: PiSessionInfo,
  metadata: SideChatSessionMetadata,
  options: { expired?: boolean; created?: boolean } = {},
): SideChatResult {
  return {
    session: toClientSessionInfo(info),
    metadata,
    expired: options.expired === true || isSideChatExpired(metadata),
    created: options.created === true,
  };
}

export async function openSideChat(options: OpenSideChatOptions): Promise<SideChatResult> {
  const {
    action,
    mainSessionId,
    sideSessionId,
    message,
  } = options;
  const forceNew = options.forceNew === true || action === "create";
  const requestedMode = options.toolMode ? normalizeSideChatToolMode(options.toolMode) : undefined;

  return withMainSessionLock(mainSessionId, async () => {
    const mainSessionPath = await resolveSessionPath(mainSessionId);
    if (!mainSessionPath) throw new Error("Main session not found");
    const { session: mainSession } = await startRpcSession(mainSessionId, mainSessionPath, undefined, {
      persistInitialPreferences: false,
    });
    const mainManager = mainSession.inner.sessionManager;
    // activity leaf anchors peek_main(since_fork); we no longer copy turns.
    const mainLeafId = mainManager.getLeafId();
    const preferences = getSessionPreferences(mainManager);
    const allSideChats = await listSideChats(mainSessionId);
    const activeSideChats = listActiveSideChats(allSideChats);

    const findById = (id: string | undefined) => (
      id ? allSideChats.find((session) => session.id === id) : undefined
    );

    // ---- set_mode / touch on existing ----
    if (action === "set_mode" || action === "touch") {
      const target = findById(sideSessionId) ?? activeSideChats[0];
      if (!target) throw new Error("Side Chat session not found");
      let metadata = readMetadataFromInfo(target)
        ?? defaultSideChatMetadata({
          mainSessionId,
          status: "active",
          forkLeafId: mainLeafId,
        });
      if (isSideChatExpired(metadata)) {
        return toResult(target, metadata, { expired: true });
      }
      await warmSideSession(target, metadata);
      if (action === "set_mode") {
        metadata = await applyToolMode(target, requestedMode ?? metadata.toolMode);
      } else {
        metadata = await touchMetadata(target);
      }
      return toResult(target, metadata);
    }

    // ---- send to existing or create+send ----
    if (action === "send") {
      const text = message?.trim() ?? "";
      if (!text) throw new Error("message is required for send");
      let target = findById(sideSessionId);
      let metadata: SideChatSessionMetadata | null = target ? readMetadataFromInfo(target) : null;
      let created = false;

      if (!target || !metadata || isSideChatExpired(metadata) || forceNew) {
        const createdSession = await createSideChatSession(
          mainSessionId,
          mainManager.getCwd(),
          mainManager.getSessionDir(),
          mainSessionPath,
          mainLeafId,
          preferences,
          requestedMode ?? "readonly",
          deriveSideChatTitle(text),
        );
        target = createdSession.info;
        metadata = createdSession.metadata;
        created = true;
      } else {
        await warmSideSession(target, metadata);
        if (requestedMode && requestedMode !== metadata.toolMode) {
          metadata = await applyToolMode(target, requestedMode);
        } else {
          metadata = await touchMetadata(target, {
            title: metadata.title ?? deriveSideChatTitle(text),
          });
        }
      }

      await sendMessageToSide(target, text);
      const refreshed = await getPiSessionInfo(target.path);
      metadata = readMetadataFromInfo(refreshed) ?? metadata;
      return toResult(refreshed, metadata, { created });
    }

    // ---- open / create: reuse non-expired or mint new ----
    if (action === "open" || action === "create") {
      if (!forceNew) {
        const preferred = findById(sideSessionId) ?? activeSideChats[0];
        if (preferred) {
          const metadata = readMetadataFromInfo(preferred)
            ?? defaultSideChatMetadata({
              mainSessionId,
              status: "active",
              forkLeafId: mainLeafId,
            });
          if (!isSideChatExpired(metadata)) {
            await warmSideSession(preferred, metadata);
            const next = await touchMetadata(preferred, requestedMode ? { toolMode: requestedMode } : {});
            if (requestedMode && requestedMode !== metadata.toolMode) {
              await applyToolMode(preferred, requestedMode);
            }
            return toResult(preferred, next);
          }
          // Expired: surface expired state so UI can offer recreate.
          if (action === "open" && sideSessionId) {
            return toResult(preferred, metadata, { expired: true });
          }
        }
      }

      const createdSession = await createSideChatSession(
        mainSessionId,
        mainManager.getCwd(),
        mainManager.getSessionDir(),
        mainSessionPath,
        mainLeafId,
        preferences,
        requestedMode ?? "readonly",
      );
      return toResult(createdSession.info, createdSession.metadata, { created: true });
    }

    // ---- refork / clear: replace one side chat ----
    if (action === "refork" || action === "clear") {
      const target = findById(sideSessionId) ?? activeSideChats[0];
      const previousMode = target
        ? (readMetadataFromInfo(target)?.toolMode ?? "readonly")
        : "readonly";
      await abortSideSession(target);

      // clear: empty session (same as create). refork: also empty + boundary
      // (Codex excludeTurns — no parent history copy either way).
      const createdSession = await createSideChatSession(
        mainSessionId,
        mainManager.getCwd(),
        mainManager.getSessionDir(),
        mainSessionPath,
        mainLeafId,
        preferences,
        requestedMode ?? previousMode,
      );

      if (target) {
        await markInactive(target);
      }
      invalidateSessionListCache();
      return toResult(createdSession.info, createdSession.metadata, { created: true });
    }

    throw new Error(`Unsupported Side Chat action: ${action}`);
  });
}

/** Back-compat wrapper used by older call sites/tests. */
export async function openSideChatLegacy(
  mainSessionId: string,
  action: "open" | "refork" | "clear",
): Promise<Pick<SideChatResult, "session">> {
  const result = await openSideChat({ mainSessionId, action });
  return { session: result.session };
}
