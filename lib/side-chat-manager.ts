import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync } from "fs";
import { cacheSessionPath, invalidateSessionListCache, resolveSessionPath } from "./session-reader";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import {
  formatSideChatSessionName,
  parseSideChatSessionName,
  SIDE_CHAT_METADATA_TYPE,
  type SideChatSessionMetadata,
  type SideChatToolMode,
} from "./side-chat-metadata";
import type { SessionInfo } from "./types";

export type SideChatAction = "open" | "refork" | "clear";

export interface SideChatResult {
  session: SessionInfo;
  toolMode: SideChatToolMode;
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

async function listSideChats(mainSessionId: string): Promise<PiSessionInfo[]> {
  const sessions = await SessionManager.listAll();
  return sessions
    .filter((session) => {
      const marker = parseSideChatSessionName(session.name);
      return marker?.mainSessionId === mainSessionId && marker.status === "active";
    })
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
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
  // The empty Clear session must be discoverable before its first prompt.
  (manager as unknown as { flushed: boolean }).flushed = true;
}

async function markInactive(info: PiSessionInfo, toolMode: SideChatToolMode): Promise<void> {
  const name = formatSideChatSessionName({
    mainSessionId: parseSideChatSessionName(info.name)?.mainSessionId ?? "",
    status: "inactive",
    toolMode,
  });
  const wrapper = getRpcSession(info.id);
  if (wrapper?.isAlive()) {
    await wrapper.send({ type: "set_session_name", name });
  } else {
    SessionManager.open(info.path).appendSessionInfo(name);
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

async function createSideChatSession(
  branchSourceManager: SessionManager,
  mainSessionId: string,
  mainCwd: string,
  mainSessionDir: string,
  mainSessionPath: string,
  contextLeafId: string | null,
  activityLeafId: string | null,
  toolMode: SideChatToolMode,
  clear: boolean,
  preferences: ReturnType<typeof getSessionPreferences>,
): Promise<PiSessionInfo> {
  const forkLeafId = activityLeafId;
  let manager: SessionManager;

  if (!clear && contextLeafId) {
    // createBranchedSession mutates its SessionManager to the new session.
    // branchSourceManager must therefore never be the live main-session manager.
    const filePath = branchSourceManager.createBranchedSession(contextLeafId);
    if (!filePath) throw new Error("Failed to create Side Chat branch");
    manager = SessionManager.open(filePath);
  } else {
    manager = SessionManager.create(mainCwd, mainSessionDir, { parentSession: mainSessionPath });
  }

  const metadata: SideChatSessionMetadata = {
    mainSessionId,
    status: "active",
    toolMode,
    forkLeafId,
  };
  appendMetadata(manager, metadata);
  ensureSessionPersisted(manager);

  const filePath = manager.getSessionFile();
  if (!filePath) throw new Error("Side Chat session is not persisted");
  const sessionId = manager.getSessionId();
  cacheSessionPath(sessionId, filePath);
  invalidateSessionListCache();

  await startRpcSession(sessionId, filePath, undefined, {
    ...preferences,
    persistInitialPreferences: false,
  });
  return getPiSessionInfo(filePath);
}

export async function openSideChat(mainSessionId: string, action: SideChatAction): Promise<SideChatResult> {
  return withMainSessionLock(mainSessionId, async () => {
    const mainSessionPath = await resolveSessionPath(mainSessionId);
    if (!mainSessionPath) throw new Error("Main session not found");
    const { session: mainSession } = await startRpcSession(mainSessionId, mainSessionPath, undefined, {
      persistInitialPreferences: false,
    });
    const mainManager = mainSession.inner.sessionManager;
    // Keep context and activity anchors separate while main is running:
    // Side Chat inherits only settled context, while peek_main observes live work.
    const mainLeafId = mainManager.getLeafId();
    const contextLeafId = mainSession.getSideChatContextLeafId();
    const branchSourceManager = SessionManager.open(mainSessionPath, mainManager.getSessionDir());
    const activeSideChats = await listSideChats(mainSessionId);
    const current = activeSideChats[0];
    // Keep metadata field for compatibility, but always open with full tools.
    const toolMode: SideChatToolMode = "edit";

    if (action === "open" && current) {
      cacheSessionPath(current.id, current.path);
      await startRpcSession(current.id, current.path, undefined, { persistInitialPreferences: false });
      return { session: toClientSessionInfo(current), toolMode };
    }

    const currentWrapper = current ? getRpcSession(current.id) : undefined;
    if (currentWrapper?.inner.isBashRunning) {
      await currentWrapper.send({ type: "abort_bash" });
    }
    if (currentWrapper?.inner.isCompacting) {
      await currentWrapper.send({ type: "abort_compaction" });
    }
    if (currentWrapper?.isRunning()) {
      await currentWrapper.send({ type: "abort" });
    }

    const created = await createSideChatSession(
      branchSourceManager,
      mainSessionId,
      mainManager.getCwd(),
      mainManager.getSessionDir(),
      mainSessionPath,
      contextLeafId,
      mainLeafId,
      toolMode,
      action === "clear",
      getSessionPreferences(mainManager),
    );

    for (const old of activeSideChats) {
      await markInactive(old, parseSideChatSessionName(old.name)?.toolMode ?? toolMode);
    }
    invalidateSessionListCache();
    return { session: toClientSessionInfo(created), toolMode };
  });
}
