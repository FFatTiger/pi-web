"use client";

import { useI18n } from "@/hooks/useI18n";
import {
  buildRightPanelMenuItems,
  type RightPanelTabAction,
} from "@/lib/right-panel-tabs";

interface RightPanelHomeProps {
  hasWorkspace: boolean;
  hasSession: boolean;
  onSelect: (action: RightPanelTabAction) => void;
  /** Compact dropdown variant for the + menu */
  variant?: "empty" | "menu";
}

function PanelIcon({ name }: { name: RightPanelTabAction }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "review":
      return (
        <svg {...common}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <path d="M13 15h4" />
        </svg>
      );
    case "browser":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M4 20h16a1 1 0 0 0 1-1V8.5L15.5 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" />
          <path d="M15 3v5h5" />
        </svg>
      );
    case "sideChat":
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      );
  }
}

function labelKey(id: RightPanelTabAction): string {
  switch (id) {
    case "review": return "panelHome.review";
    case "terminal": return "panelHome.terminal";
    case "browser": return "panelHome.browser";
    case "files": return "panelHome.files";
    case "sideChat": return "panelHome.sideChat";
  }
}

export function RightPanelHome({
  hasWorkspace,
  hasSession,
  onSelect,
  variant = "empty",
}: RightPanelHomeProps) {
  const { t } = useI18n();
  const items = buildRightPanelMenuItems({ hasWorkspace, hasSession });

  const list = (
    <div className={variant === "menu" ? "right-panel-menu-list" : "right-panel-home-list"} role="list">
      {items.map((item) => {
        const disabled = !item.enabled || !item.available;
        const title = !item.available
          ? t("panelHome.comingSoon")
          : item.id === "files" && !hasWorkspace
            ? t("panelHome.filesNeedProject")
            : item.id === "sideChat" && !hasSession
              ? t("panelHome.sideChatNeedSession")
              : t(labelKey(item.id));

        return (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className={variant === "menu" ? "right-panel-menu-item" : "right-panel-home-item"}
            disabled={disabled}
            title={title}
            aria-label={title}
            onClick={() => {
              if (disabled) return;
              onSelect(item.id);
            }}
          >
            <span className="right-panel-home-item-main">
              <span className="right-panel-home-item-icon">
                <PanelIcon name={item.id} />
              </span>
              <span className="right-panel-home-item-label">{t(labelKey(item.id))}</span>
            </span>
            {item.shortcut ? (
              <span className="right-panel-home-item-shortcut">{item.shortcut}</span>
            ) : (
              <span className="right-panel-home-item-shortcut is-empty" />
            )}
          </button>
        );
      })}
    </div>
  );

  if (variant === "menu") return list;

  return (
    <div className="right-panel-home" role="navigation" aria-label={t("panelHome.aria")}>
      {list}
    </div>
  );
}

export type { RightPanelTabAction };
