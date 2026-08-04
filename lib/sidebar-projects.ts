import type { SessionInfo } from "./types";

export type ProjectActivity = "running" | "unread" | "idle";

export interface ManualProject {
  root: string;
  lastOpened: string;
}

export interface SidebarProjectGroup {
  root: string;
  sessions: SessionInfo[];
  latestActivity: string;
  manual: boolean;
}

export interface SidebarSessionTreeNode {
  session: SessionInfo;
  children: SidebarSessionTreeNode[];
}

export interface SidebarSessionVisibilityOptions {
  runningSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  selectedSessionId: string | null;
  nowMs?: number;
  ordinaryLimit?: number;
  recentWindowMs?: number;
}

export interface SidebarSessionVisibility {
  tree: SidebarSessionTreeNode[];
  hiddenCount: number;
}

const DEFAULT_ORDINARY_SESSION_LIMIT = 5;
const DEFAULT_RECENT_SESSION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

function parseSessionTimestamp(modified: string): number {
  const parsed = Date.parse(modified);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sessionPriority(
  sessionId: string,
  options: Pick<
    SidebarSessionVisibilityOptions,
    "runningSessionIds" | "unreadSessionIds"
  >,
): number {
  if (options.runningSessionIds.has(sessionId)) return 0;
  if (options.unreadSessionIds.has(sessionId)) return 1;
  return 2;
}

export function getSidebarSessionVisibility(
  sessions: SessionInfo[],
  options: SidebarSessionVisibilityOptions,
): SidebarSessionVisibility {
  const nowMs = options.nowMs ?? Date.now();
  const ordinaryLimit = options.ordinaryLimit ?? DEFAULT_ORDINARY_SESSION_LIMIT;
  const recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_SESSION_WINDOW_MS;
  const cutoffMs = nowMs - recentWindowMs;
  const byId = new Map(sessions.map((session) => [session.id, session]));

  const ranked = sessions
    .map((session) => ({
      session,
      priority: sessionPriority(session.id, options),
      timestamp: parseSessionTimestamp(session.modified),
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.session.id.localeCompare(b.session.id);
    });

  const visibleIds = new Set<string>();
  let ordinarySelected = 0;
  for (const item of ranked) {
    if (item.priority <= 1 || options.selectedSessionId === item.session.id) {
      visibleIds.add(item.session.id);
      continue;
    }
    if (ordinarySelected >= ordinaryLimit) continue;
    if (item.timestamp < cutoffMs) continue;
    visibleIds.add(item.session.id);
    ordinarySelected += 1;
  }

  for (const id of [...visibleIds]) {
    let current = byId.get(id)?.parentSessionId;
    const visited = new Set<string>();
    while (current && byId.has(current) && !visited.has(current)) {
      visited.add(current);
      visibleIds.add(current);
      current = byId.get(current)?.parentSessionId;
    }
  }

  const visibleSessions = sessions.filter((session) => visibleIds.has(session.id));
  const tree = buildSidebarSessionTree(visibleSessions);

  type SubtreeScore = { priority: number; priorityTimestamp: number; nodeTimestamp: number; id: string };

  const scoreNode = (node: SidebarSessionTreeNode): SubtreeScore => {
    const nodeTimestamp = parseSessionTimestamp(node.session.modified);
    let best: SubtreeScore = {
      priority: sessionPriority(node.session.id, options),
      priorityTimestamp: nodeTimestamp,
      nodeTimestamp,
      id: node.session.id,
    };

    for (const child of node.children) {
      const childScore = scoreNode(child);
      if (
        childScore.priority < best.priority
        || (childScore.priority === best.priority && childScore.priorityTimestamp > best.priorityTimestamp)
      ) {
        best = {
          priority: childScore.priority,
          priorityTimestamp: childScore.priorityTimestamp,
          nodeTimestamp: best.nodeTimestamp,
          id: best.id,
        };
      }
    }

    return best;
  };

  const sortTree = (nodes: SidebarSessionTreeNode[]) => {
    const scored = nodes.map((node) => ({ node, score: scoreNode(node) }));
    scored.sort((a, b) => {
      if (a.score.priority !== b.score.priority) return a.score.priority - b.score.priority;
      if (a.score.priorityTimestamp !== b.score.priorityTimestamp) {
        return b.score.priorityTimestamp - a.score.priorityTimestamp;
      }
      if (a.score.nodeTimestamp !== b.score.nodeTimestamp) {
        return b.score.nodeTimestamp - a.score.nodeTimestamp;
      }
      return a.score.id.localeCompare(b.score.id);
    });
    nodes.splice(0, nodes.length, ...scored.map((entry) => entry.node));
    for (const node of nodes) sortTree(node.children);
  };
  sortTree(tree);

  return {
    tree,
    hiddenCount: sessions.length - visibleIds.size,
  };
}

/** Default-cwd scratch roots created by /api/default-cwd: ~/pi-cwd-YYYYMMDD */
const TEMPORARY_PROJECT_BASENAME = /^pi-cwd-\d{8}$/;

export function getProjectBasename(root: string): string {
  const normalized = root.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || root;
}

export function isTemporaryProjectRoot(root: string): boolean {
  return TEMPORARY_PROJECT_BASENAME.test(getProjectBasename(root));
}

export function getProjectDisplayName(root: string): string {
  return getProjectBasename(root);
}

/** Normalize project roots so Windows path separators / trailing slashes match. */
export function normalizeProjectRoot(root: string): string {
  return root.replace(/[\\/]+$/, "").replace(/\\/g, "/");
}

export function partitionSidebarProjects(groups: SidebarProjectGroup[]): {
  projects: SidebarProjectGroup[];
  temporary: SidebarProjectGroup[];
} {
  const projects: SidebarProjectGroup[] = [];
  const temporary: SidebarProjectGroup[] = [];
  for (const group of groups) {
    if (isTemporaryProjectRoot(group.root)) temporary.push(group);
    else projects.push(group);
  }
  return { projects, temporary };
}

export function flattenTemporarySessions(groups: SidebarProjectGroup[]): SessionInfo[] {
  return groups
    .flatMap((group) => group.sessions)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export function groupSidebarProjects(
  sessions: SessionInfo[],
  manualProjects: ManualProject[],
  projectOrder: string[] = [],
): SidebarProjectGroup[] {
  const manualByRoot = new Map(
    manualProjects.map((project) => [normalizeProjectRoot(project.root), {
      ...project,
      root: normalizeProjectRoot(project.root),
    }]),
  );
  const groups = new Map<string, SidebarProjectGroup>();

  for (const session of sessions) {
    const root = normalizeProjectRoot(session.projectRoot ?? session.cwd);
    const existing = groups.get(root);
    if (existing) {
      existing.sessions.push(session);
      if (session.modified > existing.latestActivity) existing.latestActivity = session.modified;
    } else {
      groups.set(root, {
        root,
        sessions: [session],
        latestActivity: session.modified,
        manual: manualByRoot.has(root),
      });
    }
  }

  for (const project of manualByRoot.values()) {
    const existing = groups.get(project.root);
    if (existing) {
      existing.manual = true;
      // Keep empty/manual projects from jumping to the top when lastOpened is
      // refreshed for retention. Order is owned by projectOrder.
      continue;
    }
    groups.set(project.root, {
      root: project.root,
      sessions: [],
      // Empty projects should not outrank active ones just because they were
      // pinned/retained recently.
      latestActivity: "",
      manual: true,
    });
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  const orderIndex = new Map(
    mergeProjectOrder(projectOrder, [...groups.keys()]).map((root, index) => [root, index]),
  );

  return [...groups.values()].sort((a, b) => {
    const ai = orderIndex.get(a.root) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(b.root) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    // Fallback only when both are untracked: newer activity first.
    return b.latestActivity.localeCompare(a.latestActivity);
  });
}

/**
 * Codex-style stable project order:
 * - known roots keep their previous relative order
 * - brand-new roots are appended at the end
 * - removed roots are dropped
 */
export function mergeProjectOrder(order: string[], roots: string[]): string[] {
  const normalizedRoots = roots.map(normalizeProjectRoot);
  const rootSet = new Set(normalizedRoots);
  const next: string[] = [];
  const seen = new Set<string>();

  for (const raw of order) {
    const root = normalizeProjectRoot(raw);
    if (!rootSet.has(root) || seen.has(root)) continue;
    next.push(root);
    seen.add(root);
  }
  for (const root of normalizedRoots) {
    if (seen.has(root)) continue;
    next.push(root);
    seen.add(root);
  }
  return next;
}

export function parseProjectOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(normalizeProjectRoot);
  } catch {
    return [];
  }
}

export function serializeProjectOrder(order: readonly string[]): string {
  return JSON.stringify(order.map(normalizeProjectRoot));
}

export function getProjectActivity(
  sessions: SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  unreadSessionIds: ReadonlySet<string>,
): ProjectActivity {
  if (sessions.some((session) => runningSessionIds.has(session.id))) return "running";
  if (sessions.some((session) => unreadSessionIds.has(session.id))) return "unread";
  return "idle";
}

export function buildSidebarSessionTree(sessions: SessionInfo[]): SidebarSessionTreeNode[] {
  const byId = new Map<string, SidebarSessionTreeNode>();
  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    byId.set(session.id, { session, children: [] });
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  const resolveAncestor = (id: string): string | null => {
    let current = parentOf.get(id);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (byId.has(current)) return current;
      current = parentOf.get(current);
    }
    return null;
  };

  const roots: SidebarSessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: SidebarSessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

export function parseManualProjects(raw: string | null): ManualProject[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ManualProject => Boolean(
      value
      && typeof value === "object"
      && typeof (value as ManualProject).root === "string"
      && typeof (value as ManualProject).lastOpened === "string",
    ));
  } catch {
    return [];
  }
}

export function serializeManualProjects(projects: ManualProject[]): string {
  return JSON.stringify(projects);
}

export function upsertManualProject(
  projects: ManualProject[],
  root: string,
  lastOpened: string,
): ManualProject[] {
  const normalizedRoot = normalizeProjectRoot(root);
  const existing = projects.find((project) => normalizeProjectRoot(project.root) === normalizedRoot);
  // Preserve relative position in the manual list. Order is owned by projectOrder;
  // lastOpened is retention metadata only and must not reshuffle the sidebar.
  if (existing) {
    return projects.map((project) => (
      normalizeProjectRoot(project.root) === normalizedRoot
        ? { root: normalizedRoot, lastOpened }
        : project
    ));
  }
  return [...projects, { root: normalizedRoot, lastOpened }];
}

export function removeManualProject(
  projects: ManualProject[],
  root: string,
): ManualProject[] {
  const normalizedRoot = normalizeProjectRoot(root);
  return projects.filter((project) => normalizeProjectRoot(project.root) !== normalizedRoot);
}

export function parseExpandedProjects(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function serializeExpandedProjects(projects: ReadonlySet<string>): string {
  return JSON.stringify([...projects]);
}
