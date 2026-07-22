"use client";

export type PwaSettingsControlProps = {
  isStandalone: boolean;
  onShowInstallHelp(): void;
  label?: string;
};

export function PwaSettingsControl({
  isStandalone,
  onShowInstallHelp,
  label = "Install help",
}: PwaSettingsControlProps) {
  if (isStandalone) return null;

  return (
    <button
      type="button"
      onClick={onShowInstallHelp}
      title={label}
      aria-label={label}
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 300,
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
      }}
    >
      {label}
    </button>
  );
}
