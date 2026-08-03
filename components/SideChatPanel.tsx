"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import type { AgentMessage, SessionInfo, ToolResultMessage } from "@/lib/types";
import type { SideChatToolMode } from "@/lib/side-chat-metadata";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionCustomPanel, ExtensionDialog } from "./ChatWindow";
import { MessageView } from "./MessageView";

interface SideChatPanelProps {
  active: boolean;
  mainSession: SessionInfo;
  onClose: () => void;
  onAgentEnd?: () => void;
  onOpenFile?: (filePath: string) => void;
}

type SideChatApiResult = {
  session: SessionInfo;
  toolMode: SideChatToolMode;
  error?: string;
};

async function requestSideChat(
  mainSessionId: string,
  action: "open" | "refork" | "clear" | "set_mode",
  toolMode?: SideChatToolMode,
  signal?: AbortSignal,
): Promise<SideChatApiResult> {
  const response = await fetch("/api/side-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mainSessionId, action, ...(toolMode ? { toolMode } : {}) }),
    signal,
  });
  const body = await response.json() as SideChatApiResult;
  if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function SideChatPanel({ active, mainSession, onClose, onAgentEnd, onOpenFile }: SideChatPanelProps) {
  const [sideSession, setSideSession] = useState<SessionInfo | null>(null);
  const [toolMode, setToolMode] = useState<SideChatToolMode>("readonly");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 390));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || sideSession) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    requestSideChat(mainSession.id, "open", undefined, controller.signal)
      .then((result) => {
        setSideSession(result.session);
        setToolMode(result.toolMode);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [active, mainSession.id, sideSession]);

  const runAction = useCallback(async (action: "refork" | "clear") => {
    if (actionBusy) return;
    setActionBusy(true);
    setMenuOpen(false);
    setError(null);
    try {
      const result = await requestSideChat(mainSession.id, action);
      setSideSession(result.session);
      setToolMode(result.toolMode);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, mainSession.id]);

  const toggleToolMode = useCallback(async () => {
    if (!sideSession || actionBusy) return;
    const nextMode: SideChatToolMode = toolMode === "readonly" ? "edit" : "readonly";
    setActionBusy(true);
    setError(null);
    try {
      const result = await requestSideChat(mainSession.id, "set_mode", nextMode);
      setSideSession((current) => current ? { ...current, name: result.session.name } : result.session);
      setToolMode(result.toolMode);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, mainSession.id, sideSession, toolMode]);

  const controlsDisabled = actionBusy || !sideSession;
  const buttonStyle = useMemo(() => ({
    height: 26,
    padding: "0 8px",
    border: "1px solid var(--border)",
    borderRadius: 5,
    background: "var(--bg)",
    color: "var(--text-muted)",
    cursor: controlsDisabled ? "not-allowed" : "pointer",
    opacity: controlsDisabled ? 0.5 : 1,
    fontSize: 11,
    whiteSpace: "nowrap" as const,
  }), [controlsDisabled]);

  return (
    <div ref={panelRef} style={{ display: active ? "flex" : "none", position: "relative", flex: 1, minHeight: 0, flexDirection: "column", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 7px 0 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>Side Chat</strong>
        <button type="button" disabled={controlsDisabled} onClick={() => void toggleToolMode()} title="Toggle Side Chat tool access" style={buttonStyle}>
          {toolMode === "readonly" ? "Read-only" : "Edit"}
        </button>
        {compact ? (
          <div style={{ position: "relative" }}>
            <button type="button" disabled={controlsDisabled} onClick={() => setMenuOpen((open) => !open)} aria-label="Side Chat actions" style={{ ...buttonStyle, width: 28, padding: 0 }}>…</button>
            {menuOpen && (
              <div style={{ position: "absolute", top: 30, right: 0, zIndex: 30, minWidth: 110, padding: 4, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
                <MenuButton label="Refork" onClick={() => void runAction("refork")} />
                <MenuButton label="Clear" onClick={() => void runAction("clear")} />
              </div>
            )}
          </div>
        ) : (
          <>
            <button type="button" disabled={controlsDisabled} onClick={() => void runAction("refork")} title="Recreate from the main chat's latest point" style={buttonStyle}>Refork</button>
            <button type="button" disabled={controlsDisabled} onClick={() => void runAction("clear")} title="Start an empty Side Chat" style={buttonStyle}>Clear</button>
          </>
        )}
        <button type="button" onClick={onClose} aria-label="Close Side Chat" title="Close Side Chat" style={{ ...buttonStyle, width: 26, padding: 0, cursor: "pointer", opacity: 1 }}>×</button>
      </div>

      {error && <div role="alert" style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", color: "#dc2626", fontSize: 11 }}>{error}</div>}
      {loading && !sideSession ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>Opening Side Chat…</div>
      ) : sideSession ? (
        <SideChatConversation
          key={sideSession.id}
          session={sideSession}
          onAgentEnd={onAgentEnd}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, color: "var(--text-muted)", fontSize: 12 }}>Open Side Chat to create an independent conversation.</div>
      )}
    </div>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "block", width: "100%", padding: "6px 8px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer", fontSize: 12 }}>
      {label}
    </button>
  );
}

function SideChatConversation({
  session,
  onAgentEnd,
  onOpenFile,
}: {
  session: SessionInfo;
  onAgentEnd?: () => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const inputRef = useRef<ChatInputHandle | null>(null);
  const {
    data,
    loading,
    error,
    messages,
    entryIds,
    streamState,
    agentRunning,
    agentPhase,
    bashRunning,
    isCompacting,
    compactError,
    compactResult,
    displayModel,
    modelNames,
    modelList,
    modelError,
    modelScopeWarnings,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    thinkingLevel,
    retryInfo,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    notices,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    respondToExtensionUi,
    sendExtensionCustomInput,
    messagesEndRef,
    scrollContainerRef,
    handleSend,
    handleAbort,
    handleModelChange,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleThinkingLevelChange,
    loadSlashCommands,
  } = useAgentSession({
    session,
    newSessionCwd: null,
    onAgentEnd,
    chatInputRef: inputRef,
  });
  const sessionBusy = agentRunning || bashRunning;
  const availableThinkingLevels = displayModel
    ? (modelThinkingLevels[`${displayModel.provider}:${displayModel.modelId}`] ?? null)
    : null;
  const currentThinkingLevelMap = displayModel
    ? (modelThinkingLevelMaps[`${displayModel.provider}:${displayModel.modelId}`] ?? null)
    : null;

  const toolResults = useMemo(() => {
    const result = new Map<string, ToolResultMessage>();
    for (const message of messages) {
      if (message.role === "toolResult") result.set(message.toolCallId, message);
    }
    return result;
  }, [messages]);
  const hiddenMessageEntryIds = useMemo(
    () => new Set(data?.context.hiddenMessageEntryIds ?? []),
    [data?.context.hiddenMessageEntryIds],
  );
  const visibleMessages = useMemo(() => messages
    .map((message, index) => ({ message, index }))
    .filter(({ index }) => {
      const entryId = entryIds[index];
      return !entryId || !hiddenMessageEntryIds.has(entryId);
    }), [entryIds, hiddenMessageEntryIds, messages]);

  if (loading) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading session…</div>;
  }

  return (
    <div style={{ position: "relative", display: "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
      {extensionDialog && <ExtensionDialog request={extensionDialog} onRespond={respondToExtensionUi} />}
      {extensionCustomUi && <ExtensionCustomPanel request={extensionCustomUi} onInput={sendExtensionCustomInput} />}
      {error && <div role="alert" style={{ padding: 10, color: "#dc2626", fontSize: 12 }}>{error}</div>}
      {notices.length > 0 && (
        <div style={{ padding: "6px 10px 0", display: "grid", gap: 4 }}>
          {notices.map((notice) => <div key={notice.id} style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 11 }}>{notice.message}</div>)}
        </div>
      )}
      <div ref={scrollContainerRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 12px" }}>
        {visibleMessages.length === 0 && !streamState.isStreaming && (
          <div style={{ padding: "24px 8px", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6 }}>Independent conversation based on the main chat. Use Refork to refresh its starting context.</div>
        )}
        {visibleMessages.map(({ message, index }) => (
          <MessageView
            key={entryIds[index] ?? `${message.role}-${index}`}
            message={message}
            toolResults={toolResults}
            modelNames={modelNames}
            cwd={session.cwd}
            onOpenFile={onOpenFile}
            entryId={entryIds[index]}
            sessionId={session.id}
          />
        ))}
        {streamState.isStreaming && streamState.streamingMessage && (
          <MessageView
            message={streamState.streamingMessage as AgentMessage}
            isStreaming
            toolResults={toolResults}
            modelNames={modelNames}
            cwd={session.cwd}
            onOpenFile={onOpenFile}
            sessionId={session.id}
          />
        )}
        {agentRunning && !streamState.streamingMessage && agentPhase && (
          <div style={{ padding: "6px 0", color: "var(--text-muted)", fontSize: 12 }}>Working…</div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {extensionStatuses.length > 0 && (
        <div style={{ padding: "4px 10px", borderTop: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10 }}>
          {extensionStatuses.map((status) => status.text).join(" · ")}
        </div>
      )}
      <ChatInput
        ref={inputRef}
        onSend={handleSend}
        onAbort={handleAbort}
        onSteer={agentRunning ? handleSteer : undefined}
        onFollowUp={agentRunning ? handleFollowUp : undefined}
        onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
        isStreaming={sessionBusy}
        model={displayModel}
        modelNames={modelNames}
        modelList={modelList}
        modelError={modelError}
        modelScopeWarnings={modelScopeWarnings}
        onModelChange={handleModelChange}
        onCompact={handleCompact}
        onAbortCompaction={handleAbortCompaction}
        isCompacting={isCompacting}
        compactError={compactError}
        compactResult={compactResult}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={handleThinkingLevelChange}
        availableThinkingLevels={availableThinkingLevels}
        thinkingLevelMap={currentThinkingLevelMap}
        retryInfo={retryInfo}
        queuedMessages={queuedMessages}
        onRecallQueue={handleRecallQueue}
        slashCommands={slashCommands}
        slashCommandsLoading={slashCommandsLoading}
        onLoadSlashCommands={loadSlashCommands}
        draftKey={`side-chat:${session.id}`}
        cwd={session.cwd}
        messagePlaceholder="Ask Side Chat…"
      />
    </div>
  );
}
