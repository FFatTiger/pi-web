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
    "runningSessionIds" | "unreadSessionIds" | "selectedSessionId"
  >,
): number {
  if (options.runningSessionIds.has(sessionId)) return 0;
  if (options.unreadSessionIds.has(sessionId)) return 1;
  if (options.selectedSessionId === sessionId) return 2;
  return 3;
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
    if (item.priority <= 2) {
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

export function groupSidebarProjects(
  sessions: SessionInfo[],
  manualProjects: ManualProject[],
): SidebarProjectGroup[] {
  const manualByRoot = new Map(manualProjects.map((project) => [project.root, project]));
  const groups = new Map<string, SidebarProjectGroup>();

  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
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

  for (const project of manualProjects) {
    const existing = groups.get(project.root);
    if (existing) {
      existing.manual = true;
      continue;
    }
    groups.set(project.root, {
      root: project.root,
      sessions: [],
      latestActivity: project.lastOpened,
      manual: true,
    });
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  return [...groups.values()].sort((a, b) => b.latestActivity.localeCompare(a.latestActivity));
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
  return [{ root, lastOpened }, ...projects.filter((project) => project.root !== root)];
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
