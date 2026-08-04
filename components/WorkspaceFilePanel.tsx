"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import type { RightPanelTab, RightPanelTabAction } from "@/lib/right-panel-tabs";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { RightPanelHome } from "./RightPanelHome";
import { RightPanelTabBar } from "./RightPanelTabBar";
import { TabBar, type Tab } from "./TabBar";

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

interface WorkspaceFilePanelProps {
  open: boolean;
  tabs: RightPanelTab[];
  activeTabId: string | null;
  cwd: string | null;
  fileTabs: Tab[];
  activeFileTabId: string | null;
  explorerRefreshKey: number;
  changesCollapsed: boolean;
  canOpenSideChat: boolean;
  onSelectPanelTab: (tabId: string) => void;
  onClosePanelTab: (tabId: string) => void;
  onOpenAction: (action: RightPanelTabAction) => void;
  onSelectFileTab: (tabId: string) => void;
  onCloseFileTab: (tabId: string) => void;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  onAtMentions: (relativePaths: string[]) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  onChangesCountChange?: (count: number) => void;
  sideChat?: ReactNode;
}

export function WorkspaceFilePanel(props: WorkspaceFilePanelProps) {
  const {
    open,
    tabs,
    activeTabId,
    cwd,
    fileTabs,
    activeFileTabId,
    explorerRefreshKey,
    changesCollapsed,
    canOpenSideChat,
    onSelectPanelTab,
    onClosePanelTab,
    onOpenAction,
    onSelectFileTab,
    onCloseFileTab,
    onOpenFile,
    onAtMention,
    onAtMentions,
    onMentionLines,
    onChangesCountChange,
    sideChat,
  } = props;
  const { t } = useI18n();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFile = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const activePanelTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const showEmptyHome = open && tabs.length === 0;

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
      {open && (
        <RightPanelTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          hasWorkspace={Boolean(cwd)}
          hasSession={canOpenSideChat}
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
          {/* Keep mounted tab bodies so Side Chat / Files state survives switches (Codex multi-tab). */}
          <div
            style={{
              display: activePanelTab?.kind === "files" ? "flex" : "none",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
              <div
                className="right-panel-files-explorer"
                style={{
                  width: activeFile ? "42%" : "100%",
                  minWidth: activeFile ? 180 : 0,
                  maxWidth: activeFile ? 420 : undefined,
                  borderRight: activeFile ? "1px solid var(--border)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
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
                      changesCollapsed={changesCollapsed}
                      onChangesCountChange={onChangesCountChange}
                    />
                  ) : (
                    <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
                      {t("panelHome.filesNeedProject")}
                    </div>
                  )}
                </div>
              </div>

              {activeFile?.filePath ? (
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36, paddingRight: 8 }}>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <TabBar tabs={fileTabs} activeTabId={activeFileTabId ?? ""} onSelectTab={onSelectFileTab} onCloseTab={onCloseFileTab} />
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <FileViewer
                      filePath={activeFile.filePath}
                      cwd={cwd ?? undefined}
                      sourceSessionId={activeFile.sourceSessionId}
                      onOpenFile={(filePath) => onOpenFile(filePath, getFileName(filePath), { sourceSessionId: activeFile.sourceSessionId })}
                      onMentionLines={onMentionLines}
                      gitRefreshKey={explorerRefreshKey}
                    />
                  </div>
                </div>
              ) : (
                <div className="right-panel-files-empty" style={{ display: activeFile ? "none" : fileTabs.length > 0 ? "none" : "flex" }}>
                  {/* When only explorer is open with no file preview, explorer already fills width. */}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: activePanelTab?.kind === "review" ? "flex" : "none",
              flex: 1,
              minHeight: 0,
            }}
            className="right-panel-review-placeholder"
            role="status"
          >
            <strong>{t("panelHome.reviewPlaceholder")}</strong>
            <p>{t("panelHome.reviewHint")}</p>
          </div>

          <div
            style={{
              display: activePanelTab?.kind === "sideChat" ? "flex" : "none",
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: "column",
            }}
          >
            {sideChat}
          </div>
        </>
      )}
    </div>
  );
}

/** @deprecated kept for tests / call-site migration */
export type RightPanelMode = "closed" | "home" | "explorer" | "file" | "chat" | "review";
