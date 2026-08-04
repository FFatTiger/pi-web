"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import type { SideChatSessionMetadata, SideChatToolMode } from "@/lib/side-chat-metadata";
import type { AgentMessage, SessionInfo, ToolResultMessage } from "@/lib/types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionCustomPanel, ExtensionDialog } from "./ChatWindow";
import { MessageView } from "./MessageView";

interface SideChatPanelProps {
  active: boolean;
  mainSession: SessionInfo;
  /** Existing side session to open/reuse; omit to create a new one. */
  sideSessionId?: string | null;
  /** When true, always mint a new side chat (Codex + menu / send-to-side). */
  forceNew?: boolean;
  /** Optional first message to send after open/create. */
  initialMessage?: string | null;
  onClose: () => void;
  onAgentEnd?: () => void;
  onOpenFile?: (filePath: string) => void;
  /** Notify shell when the bound side session changes (create/refork/clear). */
  onSessionChange?: (session: SessionInfo, metadata: SideChatSessionMetadata) => void;
}

type SideChatApiResult = {
  session: SessionInfo;
  metadata: SideChatSessionMetadata;
  expired?: boolean;
  created?: boolean;
  error?: string;
};

async function requestSideChat(body: {
  mainSessionId: string;
  action: "open" | "create" | "refork" | "clear" | "set_mode" | "touch" | "send";
  sideSessionId?: string;
  toolMode?: SideChatToolMode;
  message?: string;
  forceNew?: boolean;
}, signal?: AbortSignal): Promise<SideChatApiResult> {
  const response = await fetch("/api/side-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json() as SideChatApiResult;
  if (!response.ok || payload.error) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

export function SideChatPanel({
  active,
  mainSession,
  sideSessionId,
  forceNew = false,
  initialMessage,
  onClose,
  onAgentEnd,
  onOpenFile,
  onSessionChange,
}: SideChatPanelProps) {
  const { t } = useI18n();
  const [sideSession, setSideSession] = useState<SessionInfo | null>(null);
  const [metadata, setMetadata] = useState<SideChatSessionMetadata | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openedKeyRef = useRef<string | null>(null);
  const initialMessageRef = useRef(initialMessage);
  initialMessageRef.current = initialMessage;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 390));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const applyResult = useCallback((result: SideChatApiResult) => {
    setSideSession(result.session);
    setMetadata(result.metadata);
    setExpired(Boolean(result.expired));
    onSessionChange?.(result.session, result.metadata);
  }, [onSessionChange]);

  useEffect(() => {
    if (!active) return;
    const key = `${mainSession.id}:${sideSessionId ?? "new"}:${forceNew ? "force" : "reuse"}`;
    if (openedKeyRef.current === key && sideSession) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    openedKeyRef.current = key;

    const firstMessage = initialMessageRef.current?.trim() || "";
    const request = firstMessage
      ? requestSideChat({
        mainSessionId: mainSession.id,
        action: "send",
        ...(sideSessionId ? { sideSessionId } : {}),
        message: firstMessage,
        forceNew: forceNew || !sideSessionId,
      }, controller.signal)
      : requestSideChat({
        mainSessionId: mainSession.id,
        action: forceNew || !sideSessionId ? "create" : "open",
        ...(sideSessionId ? { sideSessionId } : {}),
        forceNew: forceNew || !sideSessionId,
      }, controller.signal);

    request
      .then((result) => {
        applyResult(result);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        openedKeyRef.current = null;
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [active, applyResult, forceNew, mainSession.id, sideSession, sideSessionId]);

  const runAction = useCallback(async (
    action: "refork" | "clear" | "set_mode" | "create",
    toolMode?: SideChatToolMode,
  ) => {
    if (actionBusy) return;
    setActionBusy(true);
    setMenuOpen(false);
    setError(null);
    try {
      const result = await requestSideChat({
        mainSessionId: mainSession.id,
        action,
        ...(sideSession ? { sideSessionId: sideSession.id } : {}),
        ...(toolMode ? { toolMode } : {}),
        forceNew: action === "create",
      });
      openedKeyRef.current = `${mainSession.id}:${result.session.id}:reuse`;
      applyResult(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, applyResult, mainSession.id, sideSession]);

  const toolMode: SideChatToolMode = metadata?.toolMode === "edit" ? "edit" : "readonly";
  const controlsDisabled = actionBusy || (!sideSession && !expired);
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

  const title = metadata?.title?.trim() || t("sideChat.title");

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
          title={title}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
          {!expired && sideSession && (
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void runAction("set_mode", toolMode === "readonly" ? "edit" : "readonly")}
              title={toolMode === "readonly" ? t("sideChat.editTitle") : t("sideChat.readonlyTitle")}
              aria-label={toolMode === "readonly" ? t("sideChat.edit") : t("sideChat.readonly")}
              style={{
                ...headerIconBtnStyle,
                width: "auto",
                padding: "0 7px",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.03em",
                color: toolMode === "edit" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {toolMode === "readonly" ? t("sideChat.readonly") : t("sideChat.edit")}
            </button>
          )}
          {compact ? (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                disabled={controlsDisabled && !expired}
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={t("sideChat.actions")}
                aria-expanded={menuOpen}
                style={headerIconBtnStyle}
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
                  {expired ? (
                    <MenuButton label={t("sideChat.startNew")} onClick={() => void runAction("create")} />
                  ) : (
                    <>
                      <MenuButton label={t("sideChat.refork")} onClick={() => void runAction("refork")} />
                      <MenuButton label={t("sideChat.clear")} onClick={() => void runAction("clear")} />
                    </>
                  )}
                </div>
              )}
            </div>
          ) : expired ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void runAction("create")}
              title={t("sideChat.startNew")}
              aria-label={t("sideChat.startNew")}
              style={headerIconBtnStyle}
            >
              <RefreshIcon />
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => void runAction("refork")}
                title={t("sideChat.reforkTitle")}
                aria-label={t("sideChat.refork")}
                style={headerIconBtnStyle}
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
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      {error && <div role="alert" style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", color: "#dc2626", fontSize: 11 }}>{error}</div>}
      {loading && !sideSession && !expired ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>{t("sideChat.opening")}</div>
      ) : expired ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("sideChat.expiredTitle")}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 280, lineHeight: 1.5 }}>{t("sideChat.expiredDescription")}</div>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void runAction("create")}
            style={{
              marginTop: 4,
              padding: "7px 14px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-panel)",
              color: "var(--text)",
              cursor: actionBusy ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t("sideChat.startNew")}
          </button>
        </div>
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
