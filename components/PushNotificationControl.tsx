"use client";

import { useState } from "react";
import { useWebPush } from "@/hooks/useWebPush";

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // The hook exposes a safe user-facing error.
  }
}

export type PushNotificationControlProps = {
  isIos: boolean;
  isStandalone: boolean;
};

export function PushNotificationControl({
  isIos,
  isStandalone,
}: PushNotificationControlProps): React.ReactElement {
  const push = useWebPush();
  const [open, setOpen] = useState(false);

  const iOSNeedsInstall = isIos && !isStandalone;
  const denied = push.permission === "denied";
  const title = push.subscribed ? "Completion notifications enabled" : "Completion notifications";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={title}
        title={title}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: push.subscribed ? "color-mix(in srgb, var(--accent) 16%, var(--bg-panel))" : "var(--bg-panel)",
          color: push.subscribed ? "var(--accent)" : "var(--text-muted)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          cursor: "pointer",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={push.subscribed ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>

      {open && (
        <div
          role="region"
          aria-label="Completion notification settings"
          style={{
            position: "absolute",
            right: 0,
            bottom: 44,
            width: 270,
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-panel)",
            color: "var(--text)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontWeight: 650, marginBottom: 8 }}>Completion notifications</div>

          {iOSNeedsInstall ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Add Pi Web to the Home Screen before enabling notifications.
            </p>
          ) : !push.supported ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Push notifications are not supported in this browser or secure context.
            </p>
          ) : denied ? (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Notification permission is blocked. Restore it in your browser or system settings.
            </p>
          ) : push.subscribed ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button
                type="button"
                disabled={push.busy}
                onClick={() => void runAction(push.sendTest)}
                style={actionStyle}
              >
                Send test notification
              </button>
              <button
                type="button"
                disabled={push.busy}
                onClick={() => void runAction(push.disable)}
                style={{ ...actionStyle, color: "#ef4444" }}
              >
                Disable notifications
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={push.busy}
              onClick={() => void runAction(push.enable)}
              style={actionStyle}
            >
              Enable completion notifications
            </button>
          )}

          {push.error && (
            <p role="status" aria-live="polite" style={{ margin: "8px 0 0", color: "#ef4444" }}>
              {push.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const actionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 32,
  padding: "6px 9px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-hover)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  textAlign: "left",
};
