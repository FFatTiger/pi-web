"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { RightPanelTab, RightPanelTabAction } from "@/lib/right-panel-tabs";
import { RightPanelHome } from "./RightPanelHome";

interface RightPanelTabBarProps {
  tabs: RightPanelTab[];
  activeTabId: string | null;
  hasWorkspace: boolean;
  hasSession: boolean;
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
  if (tab.kind === "files") return t("panelHome.openFiles");
  if (tab.kind === "review") return t("panelHome.review");
  return tab.kind;
}

function TabKindIcon({ kind }: { kind: RightPanelTab["kind"] }) {
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
  if (kind === "sideChat") {
    return (
      <svg {...common}>
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (kind === "files") {
    return (
      <svg {...common}>
        <path d="M4 20h16a1 1 0 0 0 1-1V8.5L15.5 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" />
        <path d="M15 3v5h5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

export function RightPanelTabBar({
  tabs,
  activeTabId,
  hasWorkspace,
  hasSession,
  onSelectTab,
  onCloseTab,
  onOpenAction,
}: RightPanelTabBarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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
    if (!menuOpen) return;
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
    // Use click (not mousedown) so the opening click on + is not raced.
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
      <div className="right-panel-tabbar-scroll">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`right-panel-tab-chip${active ? " is-active" : ""}`}
              role="tab"
              aria-selected={active}
            >
              <button
                type="button"
                className="right-panel-tab-chip-main"
                onClick={() => onSelectTab(tab.id)}
                title={tabLabel(tab, t)}
              >
                <TabKindIcon kind={tab.kind} />
                <span className="right-panel-tab-chip-label">{tabLabel(tab, t)}</span>
              </button>
              <button
                type="button"
                className="right-panel-tab-chip-close"
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
          aria-haspopup="menu"
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

      {menuOpen && menuPos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="right-panel-plus-menu"
          role="menu"
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
