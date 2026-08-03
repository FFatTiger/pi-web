"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SessionStatsInfo } from "@/lib/pi-types";

interface Props {
  soundEnabled: boolean;
  onSoundToggle: () => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  sessionStats: SessionStatsInfo | null;
  contextUsage: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  onStatsOpen?: () => void;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toLocaleString();
}

export function SessionInfoBar({
  soundEnabled,
  onSoundToggle,
  onCompact,
  onAbortCompaction,
  isCompacting = false,
  sessionStats,
  contextUsage,
  onStatsOpen,
}: Props) {
  const { t } = useI18n();
  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const contextTitle = contextUsage
    ? `${t("session.context")}: ${contextUsage.tokens === null ? "?" : contextUsage.tokens.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()}${contextUsage.percent === null ? "" : ` (${contextUsage.percent.toFixed(1)}%)`}`
    : t("session.context");
  const statsTitle = tokens
    ? [
        `${t("session.input")}: ${tokens.input.toLocaleString()}`,
        `${t("session.output")}: ${tokens.output.toLocaleString()}`,
        `${t("session.cacheRead")}: ${tokens.cacheRead.toLocaleString()}`,
        `${t("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString()}`,
        ...(cost > 0 ? [`${t("session.cost")}: $${cost.toFixed(4)}`] : []),
      ].join(" · ")
    : t("session.tokens");

  return (
    <div className="session-info-bar" aria-label={t("session.tokens")}>
      <button
        type="button"
        className="session-info-bar-button"
        onClick={onSoundToggle}
        title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
        aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
        aria-pressed={soundEnabled}
      >
        {soundEnabled ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 5a10 10 0 0 1 0 14" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="m17 9 6 6M23 9l-6 6" />
          </svg>
        )}
      </button>

      <div className="session-info-bar-spacer" />

      {onCompact && (
        <button
          type="button"
          className={`session-info-bar-button session-info-bar-compact${isCompacting ? " is-compacting" : ""}`}
          onClick={isCompacting ? onAbortCompaction : onCompact}
          title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
          aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
        >
          {isCompacting ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M21 3l-7 7" />
            </svg>
          )}
          <span>{isCompacting ? t("chat.compacting") : t("chat.compact")}</span>
        </button>
      )}

      {(tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cacheRead > 0 || cost > 0)) || contextUsage ? (
        <button
          type="button"
          className="session-info-bar-summary"
          onClick={onStatsOpen}
          disabled={!onStatsOpen}
          title={[statsTitle, contextTitle].filter(Boolean).join(" · ")}
          aria-label={[statsTitle, contextTitle].filter(Boolean).join(" · ")}
        >
          {tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cacheRead > 0 || cost > 0) && (
            <span className="session-info-bar-stats">
              {tokens.input > 0 && (
                <span className="session-info-bar-token-chip">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 10V2M3 5l3-3 3 3" /></svg>
                  {formatTokenCount(tokens.input)}
                </span>
              )}
              {tokens.output > 0 && (
                <span className="session-info-bar-token-chip">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2v8M3 7l3 3 3-3" /></svg>
                  {formatTokenCount(tokens.output)}
                </span>
              )}
              {tokens.cacheRead > 0 && (
                <span className="session-info-bar-token-chip">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><ellipse cx="6" cy="3" rx="4" ry="1.7" /><path d="M2 3v3c0 .9 1.8 1.7 4 1.7S10 6.9 10 6V3M2 6v3c0 .9 1.8 1.7 4 1.7S10 9.9 10 9V6" /></svg>
                  {formatTokenCount(tokens.cacheRead)}
                </span>
              )}
              {cost > 0 && (
                <span className="session-info-bar-token-chip session-info-bar-cost">
                  {cost >= 0.01 ? `$${cost.toFixed(2)}` : "<$0.01"}
                </span>
              )}
            </span>
          )}

          {contextUsage && (
            <span className="session-info-bar-context">
              <svg width="12" height="12" viewBox="0 0 12 12" className="session-info-bar-donut" aria-hidden="true">
                <circle cx="6" cy="6" r="4" fill="none" stroke="var(--border)" strokeWidth="2" />
                <circle
                  cx="6"
                  cy="6"
                  r="4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  pathLength="100"
                  strokeDasharray={`${Math.max(0, Math.min(100, contextUsage.percent ?? 0))} 100`}
                  transform="rotate(-90 6 6)"
                />
              </svg>
            </span>
          )}
        </button>
      ) : null}
    </div>
  );
}
