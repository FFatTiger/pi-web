/** Codex flat-project-sidebar preferences (aligned with app-initial bundle). */

export type SidebarOrganizeMode = "project" | "list";
export type SidebarChatSortMode = "priority" | "updated_at" | "manual";

export interface SidebarPreferences {
  mode: SidebarOrganizeMode;
  chatSortMode: SidebarChatSortMode;
  /** Section collapsed flags — Codex sidebar-collapsed-sections-v1 */
  collapsed: {
    projects: boolean;
    recent: boolean;
  };
}

export const SIDEBAR_PREFS_STORAGE_KEY = "pi-web:flat-project-sidebar-preferences-v1";

const DEFAULT_PREFS: SidebarPreferences = {
  mode: "project",
  chatSortMode: "updated_at",
  collapsed: {
    projects: false,
    recent: false,
  },
};

function isOrganizeMode(value: unknown): value is SidebarOrganizeMode {
  return value === "project" || value === "list";
}

function isSortMode(value: unknown): value is SidebarChatSortMode {
  return value === "priority" || value === "updated_at" || value === "manual";
}

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
  if (!raw) return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
    }
    const o = parsed as Record<string, unknown>;
    // Codex used chatSortMode; accept created_at → updated_at like their Zaa()
    let sort = o.chatSortMode;
    if (sort === "created_at") sort = "updated_at";
    const collapsed = o.collapsed && typeof o.collapsed === "object" && !Array.isArray(o.collapsed)
      ? o.collapsed as Record<string, unknown>
      : {};
    return {
      mode: isOrganizeMode(o.mode) ? o.mode : DEFAULT_PREFS.mode,
      chatSortMode: isSortMode(sort) ? sort : DEFAULT_PREFS.chatSortMode,
      collapsed: {
        projects: typeof collapsed.projects === "boolean" ? collapsed.projects : false,
        recent: typeof collapsed.recent === "boolean" ? collapsed.recent : false,
      },
    };
  } catch {
    return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
  }
}

export function serializeSidebarPreferences(prefs: SidebarPreferences): string {
  return JSON.stringify(prefs);
}

export function loadSidebarPreferences(): SidebarPreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PREFS, collapsed: { ...DEFAULT_PREFS.collapsed } };
  }
  return parseSidebarPreferences(window.localStorage.getItem(SIDEBAR_PREFS_STORAGE_KEY));
}

export function saveSidebarPreferences(prefs: SidebarPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_PREFS_STORAGE_KEY, serializeSidebarPreferences(prefs));
  } catch {
    // ignore quota
  }
}
