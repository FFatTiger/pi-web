"use client";

import { useEffect } from "react";
import { getNotificationPresentation } from "@/lib/push-types";
import type { AppToastState } from "@/hooks/useAppPresence";

export type AppToastProps = {
  toast: AppToastState | null;
  onShown(id: string): void;
  onDismiss(id: string): void;
  onOpenSession(sessionId: string): void;
};

/**
 * Renders a fixed-copy agent completion toast. Calls onShown only after the
 * toast has committed and the page is visible so ACK never races ahead of UI.
 */
export function AppToast({ toast, onShown, onDismiss, onOpenSession }: AppToastProps) {
  useEffect(() => {
    if (!toast) return;

    let acked = false;
    const maybeAck = () => {
      if (acked) return;
      if (document.visibilityState !== "visible") return;
      acked = true;
      onShown(toast.id);
    };

    maybeAck();
    document.addEventListener("visibilitychange", maybeAck);
    return () => {
      document.removeEventListener("visibilitychange", maybeAck);
    };
  }, [toast?.id, onShown, toast]);

  if (!toast) return null;

  const view = getNotificationPresentation(toast);

  return (
    <div
      role="status"
      aria-live="polite"
      data-toast-id={toast.id}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 1100,
        maxWidth: "min(360px, calc(100vw - 24px))",
        width: "100%",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{view.title}</div>
        <div>{view.body}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenSession(toast.sessionId);
            onDismiss(toast.id);
          }}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Open
        </button>
      </div>
    </div>
  );
}
