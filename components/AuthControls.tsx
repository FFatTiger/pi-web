"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GateStatusResponse } from "@/lib/web-auth-types";

export function AuthControls(): React.ReactElement | null {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<GateStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch("/api/gate/status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("status request failed");
        }
        const data = (await response.json()) as GateStatusResponse;
        if (!cancelled) {
          setStatus(data);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/gate/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout failed");
      window.location.assign("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  if (loading || !status) {
    return null;
  }

  if (status.status === "unconfigured" || status.status === "error") {
    return null;
  }

  if (status.status === "enabled") {
    return (
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        disabled={loggingOut}
        title="退出登录"
        aria-label="退出登录"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          height: 36,
          padding: "0 12px",
          background: "none",
          border: "none",
          borderLeft: "1px solid var(--border)",
          color: "var(--text-muted)",
          cursor: loggingOut ? "wait" : "pointer",
          flexShrink: 0,
          fontSize: 11,
          whiteSpace: "nowrap",
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        {!isMobile && <span>{loggingOut ? "退出中…" : "退出"}</span>}
      </button>
    );
  }

  if (status.status === "disabled") {
    const warningTitle = `认证已关闭。配置：${status.configPath}`;
    const warningLabel = `认证已关闭。配置：${status.configPath}`;

    return (
      <div
        title={warningTitle}
        aria-label={warningLabel}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 36,
          padding: "0 10px",
          borderLeft: "1px solid var(--border)",
          color: "#f59e0b",
          background: "rgba(245, 158, 11, 0.08)",
          flexShrink: 0,
          maxWidth: isMobile ? 40 : 220,
          overflow: "hidden",
          fontSize: 11,
          whiteSpace: "nowrap",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, color: "#ef4444" }}
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {!isMobile && (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>认证已关闭</span>
            <span
              style={{
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 180,
              }}
            >
              {status.configPath}
            </span>
          </span>
        )}
      </div>
    );
  }

  return null;
}
