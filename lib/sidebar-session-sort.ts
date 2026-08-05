import type { SessionInfo } from "./types";
import type { SidebarChatSortMode } from "./sidebar-preferences";

/**
 * Codex-aligned recency for "Last updated" sorting.
 * Prefer the freshest of file mtime and any live activity boost
 * (running agent, local bump after prompt). Mirrors Codex recencyAt = max(...).
 */
export function sessionRecencyMs(
  session: SessionInfo,
  activityBoostMs?: ReadonlyMap<string, number>,
): number {
  const modifiedMs = Date.parse(session.modified);
  const base = Number.isFinite(modifiedMs) ? modifiedMs : 0;
  const boost = activityBoostMs?.get(session.id) ?? Number.NEGATIVE_INFINITY;
  return Math.max(base, boost);
}

function priorityRank(
  sessionId: string,
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): number {
  // Codex priority: needs attention first (running ≈ active, then unread).
  if (runningSessionIds.has(sessionId)) return 0;
  if (unreadSessionIds.has(sessionId)) return 1;
  return 2;
}

/** Same semantics as mergeSessionOrder: keep known order, prepend unknowns. */
function mergeManualOrder(order: string[] | undefined, sessionIds: string[]): string[] {
  const idSet = new Set(sessionIds);
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of order ?? []) {
    if (!idSet.has(id) || seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  const missing = sessionIds.filter((id) => !seen.has(id));
  return [...missing, ...next];
}

export interface SortSessionsOptions {
  mode: SidebarChatSortMode;
  runningSessionIds?: ReadonlySet<string>;
  unreadSessionIds?: ReadonlySet<string>;
  /** Live bumps: sessionId → epoch ms (Codex threadRecencyAt). */
  activityBoostMs?: ReadonlyMap<string, number>;
  /** Manual order ids when mode === "manual". */
  manualOrder?: string[];
}

/**
 * Sort sessions for sidebar lists (Recent flat list or in-project trees).
 * Codex chatSortMode: priority | updated_at | manual.
 */
export function sortSessionsForChatMode(
  sessions: SessionInfo[],
  options: SortSessionsOptions,
): SessionInfo[] {
  const {
    mode,
    runningSessionIds = new Set(),
    unreadSessionIds = new Set(),
    activityBoostMs,
    manualOrder,
  } = options;

  if (sessions.length <= 1) return sessions.slice();

  if (mode === "manual") {
    const ids = sessions.map((s) => s.id);
    const ordered = mergeManualOrder(manualOrder, ids);
    const byId = new Map(sessions.map((s) => [s.id, s]));
    return ordered.map((id) => byId.get(id)).filter(Boolean) as SessionInfo[];
  }

  const ranked = sessions.map((session) => ({
    session,
    priority: mode === "priority"
      ? priorityRank(session.id, runningSessionIds, unreadSessionIds)
      : 2,
    recency: sessionRecencyMs(session, activityBoostMs),
  }));

  ranked.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.recency !== b.recency) return b.recency - a.recency;
    return a.session.id.localeCompare(b.session.id);
  });

  return ranked.map((entry) => entry.session);
}
