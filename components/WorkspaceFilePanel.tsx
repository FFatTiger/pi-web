"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import type { RightPanelTab, RightPanelTabAction } from "@/lib/right-panel-tabs";
import { CODEX_PANEL_SPRING_MS } from "./MotionPanelShell";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { RightPanelHome } from "./RightPanelHome";
import { RightPanelTabBar } from "./RightPanelTabBar";

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

interface WorkspaceFilePanelProps {
  open: boolean;
  tabs: RightPanelTab[];
  activeTabId: string | null;
  cwd: string | null;
  explorerRefreshKey: number;
  explorerOpen: boolean;
  rightPanelMaximized: boolean;
  canOpenSideChat: boolean;
  onSelectPanelTab: (tabId: string) => void;
  onClosePanelTab: (tabId: string) => void;
  onOpenAction: (action: RightPanelTabAction) => void;
  onToggleExplorer: () => void;
  onToggleRightPanelMaximized: () => void;
  onCloseRightPanel: () => void;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  onAtMentions: (relativePaths: string[]) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  sideChat?: ReactNode;
}

export function WorkspaceFilePanel(props: WorkspaceFilePanelProps) {
  const {
    open,
    tabs,
    activeTabId,
    cwd,
    explorerRefreshKey,
    explorerOpen,
    rightPanelMaximized,
    canOpenSideChat,
    onSelectPanelTab,
    onClosePanelTab,
    onOpenAction,
    onToggleExplorer,
    onToggleRightPanelMaximized,
    onCloseRightPanel,
    onOpenFile,
    onAtMention,
    onAtMentions,
    onMentionLines,
    sideChat,
  } = props;
  const { t } = useI18n();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [contentMounted, setContentMounted] = useState(open);
  const [refreshDone, setRefreshDone] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePanelTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const showEmptyHome = open && tabs.length === 0;
  const isFileSurface = activePanelTab?.kind === "files" || activePanelTab?.kind === "file";
  const activeFileTab = activePanelTab?.kind === "file" ? activePanelTab : null;
  const showFilePreview = Boolean(activeFileTab?.filePath);
  const showExplorer = isFileSurface && explorerOpen;

  useEffect(() => {
    if (open) {
      setContentMounted(true);
      return;
    }
    // Keep chrome mounted through the Codex spring close.
    const timer = window.setTimeout(() => setContentMounted(false), CODEX_PANEL_SPRING_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const refreshExplorer = () => {
    setLocalRefreshKey((value) => value + 1);
    setRefreshDone(true);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 2000);
  };

  return (
    <div
      className="workspace-file-panel-content"
      style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column", background: "var(--bg)" }}
    >
      {contentMounted && (
        <RightPanelTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          hasWorkspace={Boolean(cwd)}
          hasSession={canOpenSideChat}
          explorerOpen={explorerOpen}
          maximized={rightPanelMaximized}
          onToggleExplorer={isFileSurface ? onToggleExplorer : undefined}
          onToggleMaximized={onToggleRightPanelMaximized}
          onClosePanel={onCloseRightPanel}
          onSelectTab={onSelectPanelTab}
          onCloseTab={onClosePanelTab}
          onOpenAction={onOpenAction}
        />
      )}

      {showEmptyHome ? (
        <RightPanelHome
          hasWorkspace={Boolean(cwd)}
          hasSession={canOpenSideChat}
          onSelect={onOpenAction}
        />
      ) : (
        <>
          <div
            style={{
              display: isFileSurface ? "flex" : "none",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
              {showFilePreview ? (
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <FileViewer
                      filePath={activeFileTab!.filePath!}
                      cwd={cwd ?? undefined}
                      sourceSessionId={activeFileTab!.sourceSessionId}
                      onOpenFile={(filePath) => onOpenFile(filePath, getFileName(filePath), { sourceSessionId: activeFileTab!.sourceSessionId })}
                      onRevealPath={(path) => {
                        if (!explorerOpen) onToggleExplorer();
                        // reveal after expand paint
                        window.setTimeout(() => explorerRef.current?.revealPath(path), explorerOpen ? 0 : 50);
                      }}
                      onMentionLines={onMentionLines}
                      gitRefreshKey={explorerRefreshKey}
                      initialDisplayMode={activeFileTab!.initialDisplayMode}
                    />
                  </div>
                </div>
              ) : (
                <div className="right-panel-files-empty">
                  <div className="right-panel-files-empty-hint">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 20h16a1 1 0 0 0 1-1V8.5L15.5 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" />
                      <path d="M15 3v5h5" />
                    </svg>
                    <strong>{t("panelHome.openFiles")}</strong>
                    <p>{t("panelHome.openFilesHint")}</p>
                  </div>
                </div>
              )}

              {showExplorer && (
                <div
                  className="right-panel-files-explorer"
                  style={{
                    width: showFilePreview ? "42%" : "min(420px, 48%)",
                    minWidth: 200,
                    maxWidth: 420,
                    borderLeft: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    flexShrink: 0,
                  }}
                >
                  <div style={{ height: 36, display: "flex", alignItems: "center", padding: "0 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, gap: 6 }}>
                    <strong style={{ flex: 1, fontSize: 11, color: "var(--text)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      {t("files.explorer")}
                    </strong>
                    <button
                      type="button"
                      disabled={uploadBusy || !cwd}
                      onClick={() => explorerRef.current?.openUploadPicker()}
                      title="Upload files to project root"
                      aria-label="Upload files"
                      className="app-toolbar-btn"
                      style={{ width: 26, height: 26, margin: 0 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="m17 8-5-5-5 5" />
                        <path d="M12 3v12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={refreshExplorer}
                      title="Refresh explorer"
                      aria-label="Refresh explorer"
                      className="app-toolbar-btn"
                      style={{
                        width: 26,
                        height: 26,
                        margin: 0,
                        background: refreshDone ? "rgba(74,222,128,0.18)" : undefined,
                        color: refreshDone ? "#4ade80" : undefined,
                      }}
                    >
                      {refreshDone ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={onToggleExplorer}
                      title={t("files.hideExplorer")}
                      aria-label={t("files.hideExplorer")}
                      className="app-toolbar-btn"
                      style={{ width: 26, height: 26, margin: 0 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
                    {cwd ? (
                      <FileExplorer
                        ref={explorerRef}
                        cwd={cwd}
                        onOpenFile={onOpenFile}
                        refreshKey={explorerRefreshKey + localRefreshKey}
                        onAtMention={onAtMention}
                        onAtMentions={onAtMentions}
                        onUploadBusyChange={setUploadBusy}
                      />
                    ) : (
                      <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
                        {t("panelHome.filesNeedProject")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: activePanelTab?.kind === "sideChat" ? "flex" : "none",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: "column",
              position: "relative",
            }}
          >
            {sideChat}
          </div>
        </>
      )}
    </div>
  );
}
