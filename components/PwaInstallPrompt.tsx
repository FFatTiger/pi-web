"use client";

export type PwaInstallPromptProps = {
  canInstall: boolean;
  isIos: boolean;
  isStandalone: boolean;
  dismissed: boolean;
  promptInstall(): Promise<void>;
  dismiss(): void;
};

export function PwaInstallPrompt({
  canInstall,
  isIos,
  isStandalone,
  dismissed,
  promptInstall,
  dismiss,
}: PwaInstallPromptProps) {
  if (isStandalone || dismissed) return null;
  if (!canInstall && !isIos) return null;

  return (
    <div
      role="region"
      aria-label="Install app"
      style={{
        position: "fixed",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        maxWidth: "min(420px, calc(100vw - 24px))",
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
        {canInstall ? (
          <>Install Pi Agent Web for faster access and offline fallback.</>
        ) : (
          <>
            On iOS/iPadOS, open Share → Add to Home Screen.
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={dismiss}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Not now
        </button>
        {canInstall && (
          <button
            type="button"
            onClick={() => {
              void promptInstall();
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
            Install
          </button>
        )}
      </div>
    </div>
  );
}
