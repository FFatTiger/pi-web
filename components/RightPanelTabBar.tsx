"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { RightPanelTab, RightPanelTabAction } from "@/lib/right-panel-tabs";
import { getFileIcon } from "./FileIcons";
import { RightPanelHome } from "./RightPanelHome";

interface RightPanelTabBarProps {
  tabs: RightPanelTab[];
  activeTabId: string | null;
  hasWorkspace: boolean;
  hasSession: boolean;
  explorerOpen?: boolean;
  maximized: boolean;
  onToggleExplorer?: () => void;
  onToggleMaximized: () => void;
  onClosePanel: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenAction: (action: RightPanelTabAction) => void;
}

function tabLabel(
  tab: RightPanelTab,
  t: (key: string) => string,
): string {
  if (tab.title) return tab.title;
  if (tab.kind === "sideChat") return t("sideChat.title");
  if (tab.kind === "file") return tab.filePath?.split(/[\\/]/).pop() ?? t("panelHome.openFiles");
  return t("panelHome.openFiles");
}

function TabKindIcon({ tab }: { tab: RightPanelTab }) {
  if (tab.kind === "file") {
    return <>{getFileIcon(tab.title ?? tab.filePath ?? "file", 12)}</>;
  }
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (tab.kind === "sideChat") {
    return (
      <svg {...common}>
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 20h16a1 1 0 0 0 1-1V8.5L15.5 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" />
      <path d="M15 3v5h5" />
    </svg>
  );
}

export function RightPanelTabBar({
  tabs,
  activeTabId,
  hasWorkspace,
  hasSession,
  explorerOpen = true,
  maximized,
  onToggleExplorer,
  onToggleMaximized,
  onClosePanel,
  onSelectTab,
  onCloseTab,
  onOpenAction,
}: RightPanelTabBarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPos = () => {
    const btn = plusBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 260;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - menuWidth - 8),
    );
    setMenuPos({
      top: rect.bottom + 6,
      left,
    });
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
  }, [menuOpen]);

  useEffect(() => {
    if (!activeTabId) return;
    tabRefs.current.get(activeTabId)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (plusBtnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener("click", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("click", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="right-panel-tabbar">
      <div className="right-panel-tabbar-scroll" role="tablist" aria-label="Right panel tabs">
        {tabs.map((tab, tabIndex) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              className={`right-panel-tab-chip${active ? " is-active" : ""}`}
              data-app-shell-tab-controller="right"
              data-tab-id={tab.id}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onCloseTab(tab.id);
              }}
            >
              <button
                type="button"
                className="right-panel-tab-chip-main"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  let nextIndex = tabIndex;
                  if (event.key === "Home") nextIndex = 0;
                  else if (event.key === "End") nextIndex = tabs.length - 1;
                  else {
                    const direction = event.key === "ArrowRight" ? 1 : -1;
                    nextIndex = (tabIndex + direction + tabs.length) % tabs.length;
                  }
                  const nextTab = tabs[nextIndex];
                  if (!nextTab) return;
                  onSelectTab(nextTab.id);
                  requestAnimationFrame(() => {
                    tabRefs.current.get(nextTab.id)?.querySelector<HTMLButtonElement>("[role=tab]")?.focus();
                  });
                }}
                title={tabLabel(tab, t)}
              >
                <TabKindIcon tab={tab} />
                <span className="right-panel-tab-chip-label">{tabLabel(tab, t)}</span>
              </button>
              <button
                type="button"
                className="right-panel-tab-chip-close"
                data-app-shell-tab-close-button
                title={t("layout.closePanel")}
                aria-label={`${t("layout.closePanel")}: ${tabLabel(tab, t)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <div className="right-panel-tabbar-plus-wrap">
        <button
          ref={plusBtnRef}
          type="button"
          className="right-panel-tabbar-plus"
          title={t("panelHome.openTab")}
          aria-label={t("panelHome.openTab")}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="right-panel-tabbar-actions">
        {onToggleExplorer && (
          <button
            type="button"
            className="app-toolbar-btn"
            title={explorerOpen ? t("files.hideExplorer") : t("files.showExplorer")}
            aria-label={explorerOpen ? t("files.hideExplorer") : t("files.showExplorer")}
            aria-pressed={explorerOpen}
            data-active={explorerOpen}
            onClick={onToggleExplorer}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleMaximized}
          title={maximized ? t("layout.restorePanelWidth") : t("layout.expandPanel")}
          aria-label={maximized ? t("layout.restorePanelWidth") : t("layout.expandPanel")}
          aria-pressed={maximized}
          className="app-toolbar-btn"
          data-active={maximized}
        >
          {maximized ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M6.1664 8.80845C6.7325 8.80845 7.1918 9.26774 7.1918 9.83384V13.3338C7.19155 13.6236 6.9562 13.8592 6.6664 13.8592C6.37672 13.8591 6.14126 13.6235 6.14101 13.3338V10.5936L2.70547 14.0379C2.50071 14.243 2.16753 14.2435 1.9623 14.0389C1.75709 13.8342 1.75665 13.501 1.96133 13.2957L5.39101 9.85923H2.6664C2.37672 9.85909 2.14126 9.6235 2.14101 9.33384C2.14101 9.04397 2.37657 8.80858 2.6664 8.80845H6.1664Z" />
              <path d="M13.2943 1.96274C13.4989 1.75743 13.8311 1.75731 14.0365 1.96177C14.2419 2.16637 14.243 2.49854 14.0385 2.70395L10.6127 6.14145H13.3334C13.6233 6.14145 13.8588 6.37689 13.8588 6.66684C13.8587 6.95674 13.6233 7.19223 13.3334 7.19223H9.8334C9.26734 7.19223 8.80807 6.73288 8.80801 6.16684V2.66684C8.80801 2.37689 9.04345 2.14145 9.3334 2.14145C9.62335 2.14145 9.85879 2.37689 9.85879 2.66684V5.41098L13.2943 1.96274Z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={onClosePanel}
          title={`${t("layout.closePanel")} (Ctrl+Alt+B)`}
          aria-label={t("layout.closePanel")}
          className="app-toolbar-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="4" width="17" height="16" rx="3" />
            <path d="M15 4v16" />
          </svg>
        </button>
      </div>

      {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="right-panel-plus-menu"
          role="dialog"
          aria-label={t("panelHome.openTab")}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 1000,
          }}
        >
          <RightPanelHome
            variant="menu"
            hasWorkspace={hasWorkspace}
            hasSession={hasSession}
            onSelect={(action) => {
              setMenuOpen(false);
              onOpenAction(action);
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
