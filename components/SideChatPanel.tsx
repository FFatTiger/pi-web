"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import type { AgentMessage, SessionInfo, ToolResultMessage } from "@/lib/types";
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
  error?: string;
};

async function requestSideChat(
  mainSessionId: string,
  action: "open" | "refork" | "clear",
  signal?: AbortSignal,
): Promise<SideChatApiResult> {
  const response = await fetch("/api/side-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mainSessionId, action }),
    signal,
  });
  const body = await response.json() as SideChatApiResult;
  if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function SideChatPanel({ active, mainSession, onClose, onAgentEnd, onOpenFile }: SideChatPanelProps) {
  const { t } = useI18n();
  const [sideSession, setSideSession] = useState<SessionInfo | null>(null);
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
    requestSideChat(mainSession.id, "open", controller.signal)
      .then((result) => {
        setSideSession(result.session);
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, mainSession.id]);

  const controlsDisabled = actionBusy || !sideSession;
  // Inline styles: panel-header buttons elsewhere in the app do the same so
  // Tailwind preflight / CSS load order cannot strip the chrome.
  const headerIconBtnStyle = useMemo((): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    padding: 0,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: controlsDisabled ? "not-allowed" : "pointer",
    opacity: controlsDisabled ? 0.4 : 1,
    flexShrink: 0,
  }), [controlsDisabled]);

  return (
    <div
      ref={panelRef}
      style={{
        display: active ? "flex" : "none",
        position: "relative",
        flex: 1,
        minHeight: 0,
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 36,
          padding: "0 6px 0 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {t("sideChat.title")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          {compact ? (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={t("sideChat.actions")}
                aria-expanded={menuOpen}
                style={headerIconBtnStyle}
                onMouseEnter={(e) => {
                  if (controlsDisabled) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <MoreIcon />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    right: 0,
                    zIndex: 30,
                    minWidth: 120,
                    padding: 4,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.14)",
                  }}
                >
                  <MenuButton label={t("sideChat.refork")} onClick={() => void runAction("refork")} />
                  <MenuButton label={t("sideChat.clear")} onClick={() => void runAction("clear")} />
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void runAction("refork")}
                title={t("sideChat.reforkTitle")}
                aria-label={t("sideChat.refork")}
                style={headerIconBtnStyle}
                onMouseEnter={(e) => {
                  if (controlsDisabled) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void runAction("clear")}
                title={t("sideChat.clearTitle")}
                aria-label={t("sideChat.clear")}
                style={headerIconBtnStyle}
                onMouseEnter={(e) => {
                  if (controlsDisabled) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <ClearIcon />
              </button>
            </>
          )}
          <span
            aria-hidden="true"
            style={{ width: 1, height: 14, margin: "0 3px", background: "var(--border)", flexShrink: 0 }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sideChat.close")}
            title={t("sideChat.close")}
            style={{ ...headerIconBtnStyle, color: "var(--text-dim)", cursor: "pointer", opacity: 1 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-dim)";
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      {error && <div role="alert" style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", color: "#dc2626", fontSize: 11 }}>{error}</div>}
      {loading && !sideSession ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>{t("sideChat.opening")}</div>
      ) : sideSession ? (
        <SideChatConversation
          key={sideSession.id}
          session={sideSession}
          onAgentEnd={onAgentEnd}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, color: "var(--text-muted)", fontSize: 12 }}>{t("sideChat.openPrompt")}</div>
      )}
    </div>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "7px 10px",
        border: "none",
        borderRadius: 5,
        background: "transparent",
        color: "var(--text)",
        textAlign: "left",
        cursor: "pointer",
        fontSize: 12,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
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
  const { t } = useI18n();
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
    respondToExtensionUi,
    sendExtensionCustomInput,
    messagesEndRef,
    scrollContainerRef,
    handleSend,
    handleAbort,
    handleModelChange,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
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
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>{t("sideChat.loadingSession")}</div>;
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
          <div style={{ padding: "24px 8px", color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6 }}>{t("sideChat.emptyHint")}</div>
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
          <div style={{ padding: "6px 0", color: "var(--text-muted)", fontSize: 12 }}>{t("sideChat.working")}</div>
        )}
        <div ref={messagesEndRef} />
      </div>
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
        messagePlaceholder={t("sideChat.placeholder")}
      />
    </div>
  );
}
