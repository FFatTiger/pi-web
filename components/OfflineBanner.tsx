"use client";

export function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(560px, calc(100vw - 24px))",
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text)",
        fontSize: 13,
        lineHeight: 1.45,
        boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
        textAlign: "center",
      }}
    >
      Offline — Agent and session controls require a network connection. Showing last known state.
    </div>
  );
}
