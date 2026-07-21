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
