"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionTreeNode } from "@/lib/types";
import { BranchNavigator } from "./BranchNavigator";
import { WorktreeSwitcher } from "./WorktreeSwitcher";

type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export interface ThreadSummaryPanelProps {
  open: boolean;
  pinned: boolean;
  hasSession: boolean;
  hasWorkspace: boolean;
  cwd: string | null;
  projectRoot: string | null;
  sessionName?: string | null;
  changesCount?: number;
  systemPrompt: string | null;
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  autoNameStatus: AutoNameStatus;
  canGenerateTitle: boolean;
  generateTitleDisabledReason?: string;
  onClose: () => void;
  onTogglePinned: () => void;
  onOpenSideChat: () => void;
  onOpenFiles: () => void;
  onViewFullHistory: () => void;
  onGenerateTitle: () => void;
  onBranchLeafChange: (leafId: string | null) => void;
  onCwdChange: (cwd: string, projectRoot: string) => void;
}

function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="thread-summary-section">
      <header className="thread-summary-section-header">
        <button
          type="button"
          className="thread-summary-section-title"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span>{title}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {action}
      </header>
      {open && <div className="thread-summary-section-body">{children}</div>}
    </section>
  );
}

function SummaryRow({
  icon,
  label,
  meta,
  onClick,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      className={`thread-summary-row${disabled ? " is-disabled" : ""}${onClick ? " is-button" : ""}`}
      onClick={disabled ? undefined : onClick}
      disabled={onClick ? disabled : undefined}
      title={title}
    >
      <span className="thread-summary-row-icon">{icon}</span>
      <span className="thread-summary-row-label">{label}</span>
      {meta != null && <span className="thread-summary-row-meta">{meta}</span>}
    </Comp>
  );
}

export function ThreadSummaryPanel({
  open,
  pinned,
  hasSession,
  hasWorkspace,
  cwd,
  projectRoot,
  changesCount = 0,
  systemPrompt,
  branchTree,
  branchActiveLeafId,
  autoNameStatus,
  canGenerateTitle,
  generateTitleDisabledReason,
  onClose,
  onOpenSideChat,
  onOpenFiles,
  onViewFullHistory,
  onGenerateTitle,
  onBranchLeafChange,
  onCwdChange,
}: ThreadSummaryPanelProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [systemOpen, setSystemOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);

  useEffect(() => {
    if (!open || pinned) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      // Keep open when interacting with portaled branch dropdowns attached to body via fixed pos inside panel flow.
      const el = event.target as HTMLElement | null;
      if (el?.closest?.(".thread-summary-panel")) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, open, pinned]);

  const titleStatus = useMemo(() => {
    if (autoNameStatus.kind === "naming") return t("title.generating");
    if (autoNameStatus.kind === "success") return t("title.updated");
    if (autoNameStatus.kind === "error") return t("title.failed");
    return null;
  }, [autoNameStatus, t]);

  if (!open && !pinned) return null;

  return (
    <div
      ref={panelRef}
      className={`thread-summary-panel${pinned ? " is-pinned" : ""}`}
      role="dialog"
      aria-label={t("summary.title")}
    >
      <div className="thread-summary-scroll">
        <Section
          title={t("summary.environment")}
          action={
            hasWorkspace ? (
              <button
                type="button"
                className="thread-summary-section-action"
                title={t("files.showExplorer")}
                aria-label={t("files.showExplorer")}
                onClick={onOpenFiles}
              >
                +
              </button>
            ) : null
          }
        >
          <SummaryRow
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            }
            label={t("summary.changes")}
            meta={
              changesCount > 0 ? (
                <span className="thread-summary-diff-meta">
                  <span className="is-add">+{changesCount}</span>
                </span>
              ) : (
                <span className="thread-summary-muted">0</span>
              )
            }
            onClick={hasWorkspace ? onOpenFiles : undefined}
            disabled={!hasWorkspace}
            title={hasWorkspace ? t("files.showExplorer") : t("panelHome.filesNeedProject")}
          />

          <div className="thread-summary-embed">
            <div className="thread-summary-embed-label">{t("summary.local")}</div>
            <WorktreeSwitcher
              projectRoot={projectRoot}
              cwd={cwd}
              onCwdChange={onCwdChange}
            />
          </div>

          <div className="thread-summary-embed">
            <div className="thread-summary-embed-label">{t("summary.branches")}</div>
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={onBranchLeafChange}
              inline
              containerRef={panelRef}
              open={branchesOpen}
              onToggle={() => setBranchesOpen((value) => !value)}
              hasSession={hasSession}
            />
          </div>

          <SummaryRow
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l3 2" />
              </svg>
            }
            label={t("history.full")}
            onClick={hasSession ? onViewFullHistory : undefined}
            disabled={!hasSession}
            title={hasSession ? t("history.full") : t("history.unsaved")}
          />

          <SummaryRow
            icon={
              autoNameStatus.kind === "naming" ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 4 5 5L7 22l-5-5Z" />
                  <path d="m14 5 5 5" />
                  <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                </svg>
              )
            }
            label={titleStatus ?? t("title.generate")}
            onClick={canGenerateTitle ? onGenerateTitle : undefined}
            disabled={!canGenerateTitle}
            title={generateTitleDisabledReason ?? t("title.generateSession")}
          />

          <SummaryRow
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: systemPrompt ? "var(--accent)" : "currentColor" }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            }
            label={t("system.prompt")}
            meta={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: systemOpen ? "rotate(180deg)" : "none" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            }
            onClick={() => setSystemOpen((value) => !value)}
            title={t("system.prompt")}
          />
          {systemOpen && (
            <div className="thread-summary-system-prompt">
              {systemPrompt ? (
                <pre>{systemPrompt}</pre>
              ) : systemPrompt === "" ? (
                <p>{t("system.empty")}</p>
              ) : (
                <p>{t("system.load")}</p>
              )}
            </div>
          )}
        </Section>

        <Section title={t("summary.sideChats")}>
          <SummaryRow
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
            label={t("sideChat.title")}
            onClick={hasSession ? onOpenSideChat : undefined}
            disabled={!hasSession}
            title={hasSession ? t("sideChat.show") : t("panelHome.sideChatNeedSession")}
          />
        </Section>

        <Section title={t("summary.sources")}>
          <SummaryRow
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h16a1 1 0 0 0 1-1V8.5L15.5 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" />
                <path d="M15 3v5h5" />
              </svg>
            }
            label={t("panelHome.files")}
            onClick={hasWorkspace ? onOpenFiles : undefined}
            disabled={!hasWorkspace}
            title={hasWorkspace ? t("files.showExplorer") : t("panelHome.filesNeedProject")}
          />
          {cwd && (
            <div className="thread-summary-source-path" title={cwd}>
              {cwd}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
