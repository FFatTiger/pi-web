"use client";

import { useEffect, useRef, useState } from "react";
import { getFileName } from "@/lib/file-paths";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";

export type RightPanelMode = "closed" | "explorer" | "file";

interface WorkspaceFilePanelProps {
  mode: RightPanelMode;
  cwd: string | null;
  fileTabs: Tab[];
  activeFileTabId: string | null;
  explorerRefreshKey: number;
  onSelectFileTab: (tabId: string) => void;
  onCloseFileTab: (tabId: string) => void;
  onOpenFile: (filePath: string, fileName: string, sourceSessionId?: string | null) => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  onAtMentions: (relativePaths: string[]) => void;
}

export function WorkspaceFilePanel(props: WorkspaceFilePanelProps) {
  const {
    mode,
    cwd,
    fileTabs,
    activeFileTabId,
    explorerRefreshKey,
    onSelectFileTab,
    onCloseFileTab,
    onOpenFile,
    onAtMention,
    onAtMentions,
  } = props;
  const explorerRef = useRef<FileExplorerHandle>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;

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
      className={`right-panel-container${mode === "closed" ? " right-panel-closed" : " right-panel-open"}`}
      style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", background: "var(--bg)" }}
    >
      {mode === "explorer" ? (
        <>
          <div style={{ height: 36, display: "flex", alignItems: "center", padding: "0 8px 0 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
            <strong style={{ flex: 1, fontSize: 11, color: "var(--text)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Explorer</strong>
            <button
              type="button"
              disabled={uploadBusy || !cwd}
              onClick={() => explorerRef.current?.openUploadPicker()}
              title="Upload files to project root"
              aria-label="Upload files"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, background: "none", border: "none",
                color: "var(--text-dim)", cursor: uploadBusy || !cwd ? "not-allowed" : "pointer",
                borderRadius: 5, opacity: uploadBusy || !cwd ? 0.5 : 1,
              }}
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
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, background: refreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none", color: refreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer", borderRadius: 5,
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
              />
            ) : (
              <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>Select a project to browse files</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TabBar tabs={fileTabs} activeTabId={activeFileTabId ?? ""} onSelectTab={onSelectFileTab} onCloseTab={onCloseFileTab} />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeTab?.filePath ? (
              <FileViewer
                filePath={activeTab.filePath}
                cwd={cwd ?? undefined}
                sourceSessionId={activeTab.sourceSessionId}
                onOpenFile={(filePath) => onOpenFile(filePath, getFileName(filePath), activeTab.sourceSessionId)}
                gitRefreshKey={explorerRefreshKey}
              />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>No file open</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
