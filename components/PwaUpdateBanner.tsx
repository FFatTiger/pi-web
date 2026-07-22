"use client";

export type PwaUpdateBannerProps = {
  updateAvailable: boolean;
  activatedElsewhere: boolean;
  applying: boolean;
  applyUpdate(): void;
  runningSessionIds: Set<string>;
};

export function PwaUpdateBanner({
  updateAvailable,
  activatedElsewhere,
  applying,
  applyUpdate,
  runningSessionIds,
}: PwaUpdateBannerProps) {
  if (!updateAvailable && !activatedElsewhere) return null;

  const hasRunning = runningSessionIds.size > 0;
  const message = activatedElsewhere
    ? "A newer version is ready in another tab."
    : "A newer version of Pi Agent Web is ready.";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(560px, calc(100vw - 24px))",
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
        {message}
        {hasRunning && (
          <>
            {" "}
            Server Agent runs keep going; this page reconnects after you apply the update.
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={applyUpdate}
          disabled={applying}
          aria-busy={applying}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "#fff",
            cursor: applying ? "default" : "pointer",
            opacity: applying ? 0.7 : 1,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {applying
            ? "Updating…"
            : activatedElsewhere
              ? "Reload now"
              : "Update and reload"}
        </button>
      </div>
    </div>
  );
}
