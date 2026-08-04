"use client";

import { useEffect, useState, useCallback, useRef, useMemo, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { AuthControls } from "./AuthControls";
import {
  buildSidebarSessionTree,
  flattenTemporarySessions,
  getProjectDisplayName,
  getSidebarSessionVisibility,
  groupSidebarProjects,
  mergeProjectOrder,
  parseExpandedProjects,
  parseManualProjects,
  parseProjectOrder,
  partitionSidebarProjects,
  removeManualProject,
  serializeExpandedProjects,
  serializeManualProjects,
  serializeProjectOrder,
  upsertManualProject,
  type ManualProject,
  type SidebarProjectGroup,
  type SidebarSessionTreeNode,
} from "@/lib/sidebar-projects";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface Props {
  selectedSessionId: string | null;
  activeProjectRoot: string | null;
  onSelectProject: (projectRoot: string, fallbackCwd: string) => void;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string, projectRoot: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const RUNNING_SESSIONS_POLL_MS = 2500;
const MANUAL_PROJECTS_STORAGE_KEY = "pi-web:manual-projects";
const EXPANDED_PROJECTS_STORAGE_KEY = "pi-web:expanded-projects";
const PROJECT_ORDER_STORAGE_KEY = "pi-web:project-order";

type AnchorRect = { top: number; left: number; right: number; width: number; bottom: number; height: number };

function getViewportSize() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function getAnchorRect(node: HTMLElement): AnchorRect {
  const rect = node.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    width: rect.width,
    bottom: rect.bottom,
    height: rect.height,
  };
}

/** Fixed project menu that can open below or above the trigger to avoid clipping. */
function getProjectMenuStyle(anchor: AnchorRect): CSSProperties {
  const viewport = getViewportSize();
  const width = Math.min(180, viewport.width - 16);
  const estimatedHeight = 92;
  const gap = 6;
  const spaceBelow = viewport.height - anchor.bottom - 8;
  const openUpward = spaceBelow < estimatedHeight && anchor.top > spaceBelow;
  const left = Math.max(8, Math.min(anchor.right - width, viewport.width - width - 8));
  return {
    position: "fixed",
    top: openUpward ? undefined : Math.min(anchor.bottom + gap, viewport.height - estimatedHeight - 8),
    bottom: openUpward ? Math.max(8, viewport.height - anchor.top + gap) : undefined,
    left,
    width,
    zIndex: 1200,
    padding: 4,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
  };
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Web";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

export function SessionSidebar({
  selectedSessionId,
  activeProjectRoot,
  onSelectProject,
  onSelectSession,
  onNewSession,
  initialSessionId,
  skipInitialProjectSelection = false,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
}: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [manualProjects, setManualProjects] = useState<ManualProject[]>(() => {
    if (typeof window === "undefined") return [];
    return parseManualProjects(window.localStorage.getItem(MANUAL_PROJECTS_STORAGE_KEY));
  });
  const [projectOrder, setProjectOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return parseProjectOrder(window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY));
  });
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return parseExpandedProjects(window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY));
  });
  const [showAllSessionProjects, setShowAllSessionProjects] = useState<Set<string>>(() => new Set());
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const directoryPopoverRef = useRef<HTMLDivElement>(null);
  const initializedExpansionRef = useRef(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as { runningSessionIds?: string[] };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MANUAL_PROJECTS_STORAGE_KEY, serializeManualProjects(manualProjects));
    } catch {
      // localStorage may be unavailable in privacy mode.
    }
  }, [manualProjects]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, serializeProjectOrder(projectOrder));
    } catch {
      // localStorage may be unavailable in privacy mode.
    }
  }, [projectOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, serializeExpandedProjects(expandedProjects));
    } catch {
      // localStorage may be unavailable in privacy mode.
    }
  }, [expandedProjects]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  const projectGroups = useMemo(
    () => groupSidebarProjects(allSessions, manualProjects, projectOrder),
    [allSessions, manualProjects, projectOrder],
  );

  // Keep projectOrder as a stable superset of currently visible roots, like Codex PROJECT_ORDER.
  useEffect(() => {
    const roots = projectGroups.map((group) => group.root);
    setProjectOrder((previous) => {
      const next = mergeProjectOrder(previous, roots);
      if (next.length === previous.length && next.every((root, index) => root === previous[index])) {
        return previous;
      }
      return next;
    });
  }, [projectGroups]);
  const { projects: regularProjects, temporary: temporaryProjects } = useMemo(
    () => partitionSidebarProjects(projectGroups),
    [projectGroups],
  );
  const temporarySessions = useMemo(
    () => flattenTemporarySessions(temporaryProjects),
    [temporaryProjects],
  );

  useEffect(() => {
    if (initializedExpansionRef.current || projectGroups.length === 0) return;
    initializedExpansionRef.current = true;
    if (expandedProjects.size === 0) {
      const initialRoot = activeProjectRoot ?? projectGroups[0].root;
      setExpandedProjects(new Set([initialRoot]));
    }
  }, [activeProjectRoot, expandedProjects.size, projectGroups]);

  // Auto-select project and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 && projectGroups.length === 0) return;
    if (initialSessionId && !restoredRef.current) {
      if (allSessions.length === 0) return;
      restoredRef.current = true;
      const target = allSessions.find((session) => session.id === initialSessionId);
      if (target) {
        setExpandedProjects((previous) => new Set(previous).add(target.projectRoot ?? target.cwd));
        onSelectSession(target, true);
        return;
      }
      onInitialRestoreDone?.();
    }
    if (skipInitialProjectSelection) return;
    if (!activeProjectRoot && projectGroups.length > 0) {
      const first = projectGroups[0];
      onSelectProject(first.root, first.root);
    }
  }, [activeProjectRoot, allSessions, initialSessionId, onInitialRestoreDone, onSelectProject, onSelectSession, projectGroups, skipInitialProjectSelection]);

  const activateManualProject = useCallback((root: string) => {
    const openedAt = new Date().toISOString();
    setManualProjects((previous) => upsertManualProject(previous, root, openedAt));
    // New projects append to the end of the stable order; existing ones keep place.
    setProjectOrder((previous) => mergeProjectOrder(previous, [...previous, root]));
    setExpandedProjects((previous) => new Set(previous).add(root));
    onSelectProject(root, root);
    setDirectoryOpen(false);
    setCustomPathValue("");
    setCustomPathError(null);
  }, [onSelectProject]);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      activateManualProject(data.cwd ?? path);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [activateManualProject, customPathValue, customPathValidating]);

  const handleDirectoryButtonClick = useCallback(async () => {
    const desktop = window.piDesktop;
    if (!desktop) {
      setDirectoryOpen((open) => !open);
      setCustomPathError(null);
      setTimeout(() => customPathInputRef.current?.focus(), 0);
      return;
    }

    try {
      setCustomPathError(null);
      const path = await desktop.selectDirectory();
      if (path === null) return;

      setCustomPathValue(path);
      setDirectoryOpen(true);
      await commitCustomPath(path);
    } catch (e) {
      setDirectoryOpen(true);
      setCustomPathError(e instanceof Error ? e.message : String(e));
      setTimeout(() => customPathInputRef.current?.focus(), 0);
    }
  }, [commitCustomPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        activateManualProject(data.cwd);
      }
    } catch {
      // ignore
    }
  }, [activateManualProject]);

  // Close directory popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (directoryPopoverRef.current && !directoryPopoverRef.current.contains(e.target as Node)) {
        setDirectoryOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleProject = useCallback((group: SidebarProjectGroup) => {
    if (!selectedSessionId) onSelectProject(group.root, group.root);
    setExpandedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(group.root)) next.delete(group.root);
      else next.add(group.root);
      return next;
    });
  }, [onSelectProject, selectedSessionId]);

  const toggleShowAllSessions = useCallback((projectRoot: string) => {
    setShowAllSessionProjects((previous) => {
      const next = new Set(previous);
      if (next.has(projectRoot)) next.delete(projectRoot);
      else next.add(projectRoot);
      return next;
    });
  }, []);

  const startProjectSession = useCallback((group: SidebarProjectGroup) => {
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    // AppShell resolves the remembered per-project cwd from projectCwds.
    onNewSession?.(tempId, group.root, group.root);
  }, [onNewSession]);

  type ProjectDialogMode = "clear" | "remove";
  const [projectDialog, setProjectDialog] = useState<{ group: SidebarProjectGroup; mode: ProjectDialogMode } | null>(null);
  const [projectDialogBusy, setProjectDialogBusy] = useState(false);
  const [projectDialogError, setProjectDialogError] = useState<string | null>(null);

  const persistManualProjects = useCallback((projects: ManualProject[]) => {
    setManualProjects(projects);
    try {
      window.localStorage.setItem(MANUAL_PROJECTS_STORAGE_KEY, serializeManualProjects(projects));
    } catch {
      // localStorage may be unavailable in privacy mode.
    }
  }, []);

  const deleteProjectSessions = useCallback(async (
    group: SidebarProjectGroup,
    errorKey: "sidebar.clearChatsError" | "sidebar.removeProjectError",
    options?: { notifyParent?: boolean },
  ) => {
    const sessionIds = group.sessions.map((session) => session.id);
    if (sessionIds.length === 0) return [] as string[];
    const results = await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        return sessionId;
      }),
    );
    const deletedIds: string[] = [];
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") deletedIds.push(result.value);
      else failed += 1;
    }
    // Notify parent once per deleted session only after bulk delete finishes,
    // so intermediate refreshKey reloads cannot drop a project that is not yet
    // pinned in manualProjects.
    if (options?.notifyParent !== false) {
      for (const sessionId of deletedIds) onSessionDeleted?.(sessionId);
    }
    if (failed > 0) {
      throw new Error(`${t(errorKey)} (${failed}/${sessionIds.length})`);
    }
    return deletedIds;
  }, [onSessionDeleted, t]);

  const handleProjectDialogConfirm = useCallback(async () => {
    if (!projectDialog || projectDialogBusy) return;
    setProjectDialogBusy(true);
    setProjectDialogError(null);
    const { group, mode } = projectDialog;
    try {
      if (mode === "clear") {
        if (group.sessions.length === 0) {
          throw new Error(t("sidebar.clearChatsEmpty"));
        }
        // Pin the empty project BEFORE deletes. Otherwise each onSessionDeleted
        // bumps refreshKey, reloads the session list, and the project vanishes
        // because it only existed via session-backed grouping.
        // Do NOT reshuffle projectOrder here — clear should keep the same place.
        const pinned = upsertManualProject(manualProjects, group.root, new Date().toISOString());
        persistManualProjects(pinned);
        setProjectOrder((previous) => mergeProjectOrder(previous, [...previous, group.root]));
        setExpandedProjects((previous) => new Set(previous).add(group.root));
        // Optimistically clear sessions in UI so the empty project stays visible.
        setAllSessions((previous) => previous.filter((session) => {
          const root = session.projectRoot ?? session.cwd;
          return root !== group.root;
        }));
        const deletedIds = await deleteProjectSessions(group, "sidebar.clearChatsError", { notifyParent: false });
        for (const sessionId of deletedIds) onSessionDeleted?.(sessionId);
      } else {
        const deletedIds = await deleteProjectSessions(group, "sidebar.removeProjectError", { notifyParent: false });
        persistManualProjects(removeManualProject(manualProjects, group.root));
        setProjectOrder((previous) => previous.filter((root) => root !== group.root));
        setExpandedProjects((previous) => {
          if (!previous.has(group.root)) return previous;
          const next = new Set(previous);
          next.delete(group.root);
          return next;
        });
        setShowAllSessionProjects((previous) => {
          if (!previous.has(group.root)) return previous;
          const next = new Set(previous);
          next.delete(group.root);
          return next;
        });
        setAllSessions((previous) => previous.filter((session) => {
          const root = session.projectRoot ?? session.cwd;
          return root !== group.root;
        }));
        for (const sessionId of deletedIds) onSessionDeleted?.(sessionId);
      }
      await loadSessions(false);
      setProjectDialog(null);
    } catch (error) {
      setProjectDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectDialogBusy(false);
    }
  }, [deleteProjectSessions, loadSessions, manualProjects, onSessionDeleted, persistManualProjects, projectDialog, projectDialogBusy, t]);

  const renderProjectGroup = (group: SidebarProjectGroup) => {
    const expanded = expandedProjects.has(group.root);
    const selected = activeProjectRoot === group.root;
    const fullTree = buildSidebarSessionTree(group.sessions);
    const visibility = getSidebarSessionVisibility(group.sessions, {
      runningSessionIds,
      unreadSessionIds,
      selectedSessionId,
    });
    const showAllSessions = showAllSessionProjects.has(group.root);
    return (
      <ProjectGroup
        key={group.root}
        group={group}
        expanded={expanded}
        selected={selected}
        selectedSessionId={selectedSessionId}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        onToggle={() => toggleProject(group)}
        onNewSession={(event) => {
          event.stopPropagation();
          startProjectSession(group);
        }}
        onClearChats={() => {
          setProjectDialogError(null);
          setProjectDialog({ group, mode: "clear" });
        }}
        onRemoveProject={() => {
          setProjectDialogError(null);
          setProjectDialog({ group, mode: "remove" });
        }}
        onSelectSession={onSelectSession}
        onRenamed={loadSessions}
        onSessionDeleted={(id) => {
          onSessionDeleted?.(id);
          void loadSessions();
        }}
        tree={showAllSessions ? fullTree : visibility.tree}
        hiddenCount={visibility.hiddenCount}
        showAllSessions={showAllSessions}
        onToggleShowAllSessions={() => toggleShowAllSessions(group.root)}
      />
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <PiWebTitle />
          <div style={{ display: "flex", gap: 6, position: "relative" }} ref={directoryPopoverRef}>
            <button
              onClick={() => void loadSessions(false)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "var(--bg-hover)",
                border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                color: sessionRefreshDone ? "#4ade80" : "var(--text-muted)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.3s, color 0.3s, border-color 0.3s",
              }}
              onMouseEnter={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              title="Refresh"
              aria-label="Refresh sessions"
            >
              {sessionRefreshDone ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
            <button
              onClick={() => void handleDirectoryButtonClick()}
              title="Open directory"
              aria-label="Open directory"
              aria-expanded={directoryOpen}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: directoryOpen ? "var(--bg-selected)" : "var(--bg-hover)",
                border: `1px solid ${directoryOpen ? "rgba(37,99,235,0.35)" : "var(--border)"}`,
                color: directoryOpen ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = directoryOpen ? "var(--bg-selected)" : "var(--bg-hover)";
                e.currentTarget.style.color = directoryOpen ? "var(--accent)" : "var(--text-muted)";
                e.currentTarget.style.borderColor = directoryOpen ? "rgba(37,99,235,0.35)" : "var(--border)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
            </button>
            <AuthControls compact />

            <AnimatedDropdown
              open={directoryOpen}
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                width: 260,
                zIndex: 100,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "8px" }}>
                <input
                  ref={customPathInputRef}
                  value={customPathValue}
                  onChange={(e) => {
                    setCustomPathValue(e.target.value);
                    setCustomPathError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitCustomPath();
                    }
                    if (e.key === "Escape") {
                      setDirectoryOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                    }
                  }}
                  placeholder="/path/to/project"
                  aria-label="Project directory path"
                  style={{
                    width: "100%",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    padding: "5px 8px",
                    border: "1px solid var(--accent)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    boxSizing: "border-box",
                  }}
                />
                {customPathError && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 5,
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {customPathError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                  <button
                    type="button"
                    onClick={() => void commitCustomPath()}
                    disabled={customPathValidating || !customPathValue.trim()}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "var(--accent)",
                      border: "none",
                      borderRadius: 5,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                      opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                    }}
                  >
                    {customPathValidating ? "Checking…" : "Open"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDirectoryOpen(false); setCustomPathValue(""); setCustomPathError(null); }}
                    style={{
                      flex: 1,
                      padding: "4px 0",
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      color: "var(--text-muted)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleDefaultCwd(); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderTop: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>Use default directory</span>
              </button>
            </AnimatedDropdown>
          </div>
        </div>
      </div>

      {/* Project / temporary sections */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0 10px", minHeight: 0 }}>
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && projectGroups.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            Open a directory to get started
          </div>
        )}

        {regularProjects.length > 0 && (
          <SidebarSection label={t("sidebar.projectsSection")}>
            {regularProjects.map((group) => renderProjectGroup(group))}
          </SidebarSection>
        )}

        {(temporaryProjects.length > 0 || temporarySessions.length > 0) && (
          <SidebarSection label={t("sidebar.temporarySection")}>
            {temporarySessions.length === 0 ? (
              <div style={{ padding: "6px 14px 10px 34px", fontSize: 12, color: "var(--text-dim)" }}>
                {t("sidebar.noChats")}
              </div>
            ) : (
              temporarySessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isSelected={session.id === selectedSessionId}
                  isRunning={runningSessionIds.has(session.id)}
                  isUnread={unreadSessionIds.has(session.id)}
                  onClick={() => onSelectSession(session)}
                  onRenamed={loadSessions}
                  onDeleted={(id) => {
                    onSessionDeleted?.(id);
                    void loadSessions();
                  }}
                />
              ))
            )}
          </SidebarSection>
        )}
      </div>

      {projectDialog && (
        <ProjectActionDialog
          mode={projectDialog.mode}
          projectName={getProjectDisplayName(projectDialog.group.root)}
          chatCount={projectDialog.group.sessions.length}
          busy={projectDialogBusy}
          error={projectDialogError}
          onCancel={() => {
            if (projectDialogBusy) return;
            setProjectDialog(null);
            setProjectDialogError(null);
          }}
          onConfirm={() => void handleProjectDialogConfirm()}
        />
      )}
    </div>
  );
}

function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 4, marginBottom: 8 }}>
      <div
        style={{
          padding: "8px 14px 4px",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.01em",
          userSelect: "none",
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ProjectGroup({
  group,
  expanded,
  selected,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onToggle,
  onNewSession,
  onClearChats,
  onRemoveProject,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  tree,
  hiddenCount,
  showAllSessions,
  onToggleShowAllSessions,
}: {
  group: SidebarProjectGroup;
  expanded: boolean;
  selected: boolean;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onToggle: () => void;
  onNewSession: (event: React.MouseEvent) => void;
  onClearChats: () => void;
  onRemoveProject: () => void;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onRenamed: () => void;
  onSessionDeleted: (id: string) => void;
  tree: SidebarSessionTreeNode[];
  hiddenCount: number;
  showAllSessions: boolean;
  onToggleShowAllSessions: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<AnchorRect | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const label = getProjectDisplayName(group.root);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuRect(null);
  }, []);

  const openMenu = useCallback(() => {
    const button = menuButtonRef.current;
    if (!button) return;
    setMenuRect(getAnchorRect(button));
    setMenuOpen(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const onReposition = () => {
      const button = menuButtonRef.current;
      if (!button) return;
      setMenuRect(getAnchorRect(button));
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [closeMenu, menuOpen]);

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={group.root}
        aria-expanded={expanded}
        aria-label={`Project ${label}`}
        style={{
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 10px 5px 12px",
          margin: "0 6px",
          cursor: "pointer",
          background: selected
            ? "var(--bg-selected)"
            : hovered
              ? "var(--bg-hover)"
              : "transparent",
          borderRadius: 8,
          border: "none",
          transition: "background 0.1s",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: selected ? "var(--text)" : "var(--text-muted)",
          }}
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
            color: selected ? "var(--text)" : "var(--text)",
            fontWeight: selected ? 550 : 450,
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </span>
        <button
          type="button"
          onClick={onNewSession}
          title={t("sidebar.newSessionTitle", { path: group.root })}
          aria-label={t("sidebar.newSessionTitle", { path: label })}
          style={{
            display: hovered || selected || menuOpen ? "flex" : "none",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 6,
            color: "var(--text-dim)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-dim)";
            e.currentTarget.style.background = "none";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="1" x2="6" y2="11" />
            <line x1="1" y1="6" x2="11" y2="6" />
          </svg>
        </button>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (menuOpen) closeMenu();
              else openMenu();
            }}
            title={t("sidebar.projectActions")}
            aria-label={t("sidebar.projectActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              display: hovered || selected || menuOpen ? "flex" : "none",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              padding: 0,
              background: menuOpen ? "var(--bg-hover)" : "none",
              border: "none",
              borderRadius: 6,
              color: "var(--text-dim)",
              cursor: "pointer",
              transition: "color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-dim)";
              e.currentTarget.style.background = menuOpen ? "var(--bg-hover)" : "none";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12.5" cy="8" r="1.3" />
            </svg>
          </button>
          {menuOpen && menuRect && createPortal(
            <div
              ref={menuPanelRef}
              role="menu"
              style={getProjectMenuStyle(menuRect)}
            >
              <button
                type="button"
                role="menuitem"
                disabled={group.sessions.length === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  if (group.sessions.length === 0) return;
                  closeMenu();
                  onClearChats();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 7,
                  background: "transparent",
                  color: group.sessions.length === 0 ? "var(--text-dim)" : "var(--text)",
                  cursor: group.sessions.length === 0 ? "not-allowed" : "pointer",
                  fontSize: 13,
                  textAlign: "left",
                  opacity: group.sessions.length === 0 ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (group.sessions.length === 0) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
                <span>{t("sidebar.clearChats")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation();
                  closeMenu();
                  onRemoveProject();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 7,
                  background: "transparent",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontSize: 13,
                  textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
                <span>{t("sidebar.removeProject")}</span>
              </button>
            </div>,
            document.body,
          )}
        </div>
      </div>
      {expanded && (
        group.sessions.length === 0 ? (
          <div style={{
            padding: "4px 14px 8px 36px",
            fontSize: 12,
            color: "var(--text-dim)",
          }}>
            {t("sidebar.noChats")}
          </div>
        ) : (
          <div>
            {tree.map((node) => (
              <SessionTreeItem
                key={node.session.id}
                node={node}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelectSession={onSelectSession}
                onRenamed={onRenamed}
                onSessionDeleted={onSessionDeleted}
                depth={0}
              />
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleShowAllSessions();
                }}
                aria-expanded={showAllSessions}
                style={{
                  width: "100%",
                  height: 28,
                  padding: "0 14px 0 36px",
                  display: "flex",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {showAllSessions ? t("sidebar.collapseSessions") : t("sidebar.expandSessions")}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

function ProjectActionDialog({
  mode,
  projectName,
  chatCount,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  mode: "clear" | "remove";
  projectName: string;
  chatCount: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const isClear = mode === "clear";
  const title = isClear
    ? t("sidebar.clearChatsTitle", { name: projectName })
    : t("sidebar.removeProjectTitle", { name: projectName });
  const body = isClear
    ? t("sidebar.clearChatsBody")
    : t("sidebar.removeProjectBody");
  const confirmLabel = busy
    ? (isClear ? t("sidebar.clearingChats") : t("sidebar.removingProject"))
    : (isClear ? t("sidebar.clearChatsConfirm") : t("sidebar.removeProjectConfirm"));

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.28)",
      }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-action-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 18px 8px" }}>
          <div id="project-action-title" style={{ fontSize: 15, fontWeight: 650, color: "var(--text)" }}>
            {title}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)" }}>
            {body}
            {chatCount > 0 ? ` (${chatCount})` : ""}
          </div>
          {error && (
            <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>
              {error}
            </div>
          )}
        </div>
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {t("sidebar.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid #dc2626",
              background: "#dc2626",
              color: "#fff",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: busy ? 0.75 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SidebarSessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo, isRestore?: boolean) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  return (
    <span
      title="Agent running…"
      aria-label="Agent running"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  return (
    <span
      title="New activity"
      aria-label="New session activity"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const performDelete = useCallback(async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 34;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        margin: "1px 6px",
        paddingLeft: depth > 0 ? depth * 12 + 28 : 34,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 8,
        border: "none",
        boxShadow: confirmDelete
          ? "inset 2px 0 0 #ef4444"
          : "none",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Delete <span style={{ fontWeight: 600 }}>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : renaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        <>
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.35,
                color: isSelected ? "var(--text)" : "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`${title}${session.worktreeBranch ? ` · ${session.worktreeBranch}` : ""} · ${formatRelativeTime(session.modified)} · ${session.messageCount} msgs`}
            >
              {title}
            </div>
            {(isRunning || isUnread) && (
              <span style={{ display: "inline-flex", flexShrink: 0 }}>
                {isRunning ? <RunningSessionIndicator /> : <UnreadSessionIndicator />}
              </span>
            )}
          </div>

          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? "Expand forks" : "Collapse forks"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title="Rename"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
                title="Delete"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
