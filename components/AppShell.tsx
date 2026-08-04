"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import type { Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { BranchNavigator } from "./BranchNavigator";
import { WorktreeSwitcher } from "./WorktreeSwitcher";
import { WorkspaceFilePanel } from "./WorkspaceFilePanel";
import { SideChatPanel } from "./SideChatPanel";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import {
  blankPanelAfterLeaveSession,
  captureSessionFilePanelState,
  emptySessionFilePanelState,
  type SessionFilePanelState,
} from "@/lib/session-file-panel";
import {
  actionToTabKind,
  closeRightPanelTab,
  emptyRightPanelTabs,
  findTabByKind,
  openOrFocusRightPanelTab,
  type RightPanelTab,
  type RightPanelTabAction,
  type RightPanelTabKind,
} from "@/lib/right-panel-tabs";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";

type SessionCopyField = "file" | "id";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { isDark, toggleTheme } = useTheme();
  const { t: translate } = useI18n();
  const isMobile = useIsMobile();
  useViewportHeight();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const initialSessionId = initialNavigation.sessionId;
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // Codex-style orthogonal right-panel chrome + multi-tab content.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelMaximized, setRightPanelMaximized] = useState(false);
  const [rightPanelTabs, setRightPanelTabs] = useState<RightPanelTab[]>([]);
  const [activeRightPanelTabId, setActiveRightPanelTabId] = useState<string | null>(null);
  // Side Chat open/closed is remembered per main session so switching A→B
  // does not carry A's panel, and returning to A restores it.
  const sideChatOpenBySessionRef = useRef(new Map<string, boolean>());
  // Codex-style: open file tabs are conversation-scoped.
  const filePanelBySessionRef = useRef(new Map<string, SessionFilePanelState>());
  // Right panel shell tabs (side chat / files / review) per main session.
  const rightPanelTabsBySessionRef = useRef(new Map<string, { tabs: RightPanelTab[]; activeTabId: string | null }>());
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  // On mobile, an empty entry starts in the session chooser. A direct session
  // URL keeps the drawer closed while restoration is pending; if the target is
  // missing, the chooser reopens once resolution completes.
  useEffect(() => {
    if (!isMobile) return;
    if (initialSessionId && !initialSessionRestored) {
      setSidebarOpen(false);
    } else if (!selectedSession && !newSessionCwd) {
      setSidebarOpen(true);
    }
  }, [initialSessionId, initialSessionRestored, isMobile, newSessionCwd, selectedSession]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;

  const rememberSideChatOpen = useCallback((sessionId: string | null | undefined, open: boolean) => {
    if (!sessionId) return;
    sideChatOpenBySessionRef.current.set(sessionId, open);
  }, []);

  const persistRightPanelTabs = useCallback((sessionId: string | null | undefined, tabs: RightPanelTab[], activeTabId: string | null) => {
    if (!sessionId) return;
    rightPanelTabsBySessionRef.current.set(sessionId, {
      tabs: tabs.map((tab) => ({ ...tab })),
      activeTabId,
    });
    rememberSideChatOpen(sessionId, tabs.some((tab) => tab.kind === "sideChat"));
  }, [rememberSideChatOpen]);

  const closeRightPanel = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      persistRightPanelTabs(sessionId, rightPanelTabs, activeRightPanelTabId);
    }
    setRightPanelOpen(false);
    setRightPanelMaximized(false);
  }, [activeRightPanelTabId, persistRightPanelTabs, rightPanelTabs]);

  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session") => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const toggleSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((current) => current === "session" ? null : "session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setActiveTopPanel(null);
      closeRightPanel();
    }
    setSidebarOpen((open) => !open);
  }, [closeRightPanel, isMobile]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // File viewer tabs inside the Files panel tab (Codex open files).
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [changesCount, setChangesCount] = useState(0);
  const fileTabsRef = useRef<Tab[]>(fileTabs);
  const activeFileTabIdRef = useRef<string | null>(activeFileTabId);
  const rightPanelTabsRef = useRef<RightPanelTab[]>(rightPanelTabs);
  const activeRightPanelTabIdRef = useRef<string | null>(activeRightPanelTabId);
  fileTabsRef.current = fileTabs;
  activeFileTabIdRef.current = activeFileTabId;
  rightPanelTabsRef.current = rightPanelTabs;
  activeRightPanelTabIdRef.current = activeRightPanelTabId;

  const activeRightPanelTab = rightPanelTabs.find((tab) => tab.id === activeRightPanelTabId) ?? null;
  const rightPanelMode = !rightPanelOpen
    ? "closed"
    : activeRightPanelTab?.kind === "sideChat"
      ? "chat"
      : activeRightPanelTab?.kind === "review"
        ? "review"
        : activeRightPanelTab?.kind === "files"
          ? (fileTabs.length > 0 ? "file" : "explorer")
          : "home";

  // Keep the active session's open-files + panel-tabs snapshots fresh.
  useEffect(() => {
    const sessionId = selectedSession?.id;
    if (!sessionId) return;
    filePanelBySessionRef.current.set(
      sessionId,
      captureSessionFilePanelState({
        tabs: fileTabs,
        activeTabId: activeFileTabId,
        filesSurface: "file",
      }),
    );
    persistRightPanelTabs(sessionId, rightPanelTabs, activeRightPanelTabId);
  }, [activeFileTabId, activeRightPanelTabId, fileTabs, persistRightPanelTabs, rightPanelTabs, selectedSession?.id]);

  const captureCurrentSessionFilePanel = useCallback(() => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    filePanelBySessionRef.current.set(
      sessionId,
      captureSessionFilePanelState({
        tabs: fileTabsRef.current,
        activeTabId: activeFileTabIdRef.current,
        filesSurface: "file",
      }),
    );
    persistRightPanelTabs(sessionId, rightPanelTabsRef.current, activeRightPanelTabIdRef.current);
  }, [persistRightPanelTabs]);

  const applySessionFilePanel = useCallback((sessionId: string | null) => {
    if (!sessionId) {
      const blank = blankPanelAfterLeaveSession();
      const emptyTabs = emptyRightPanelTabs();
      setFileTabs(blank.tabs);
      setActiveFileTabId(blank.activeTabId);
      setRightPanelTabs(emptyTabs.tabs);
      setActiveRightPanelTabId(emptyTabs.activeTabId);
      setRightPanelOpen(false);
      setRightPanelMaximized(false);
      return;
    }
    const restored = filePanelBySessionRef.current.get(sessionId) ?? emptySessionFilePanelState();
    setFileTabs(restored.tabs.map((tab) => ({ ...tab })));
    setActiveFileTabId(restored.activeTabId);

    const savedPanel = rightPanelTabsBySessionRef.current.get(sessionId);
    let nextTabs = savedPanel?.tabs.map((tab) => ({ ...tab })) ?? [];
    let nextActive = savedPanel?.activeTabId ?? null;
    // Rehydrate side-chat preference if tabs snapshot missing it.
    if (sideChatOpenBySessionRef.current.get(sessionId) === true && !findTabByKind(nextTabs, "sideChat")) {
      const opened = openOrFocusRightPanelTab(nextTabs, "sideChat");
      nextTabs = opened.tabs;
      nextActive = opened.activeTabId;
    }
    // Restore files tab when the session had open files.
    if (restored.tabs.length > 0 && !findTabByKind(nextTabs, "files")) {
      const opened = openOrFocusRightPanelTab(nextTabs, "files");
      nextTabs = opened.tabs;
      if (!nextActive) nextActive = opened.activeTabId;
    }
    if (nextActive && !nextTabs.some((tab) => tab.id === nextActive)) {
      nextActive = nextTabs[nextTabs.length - 1]?.id ?? null;
    }
    setRightPanelTabs(nextTabs);
    setActiveRightPanelTabId(nextActive);
    setRightPanelOpen(nextTabs.length > 0);
    if (nextTabs.length === 0) setRightPanelMaximized(false);
  }, []);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [activeProjectRoot, setActiveProjectRoot] = useState<string | null>(null);
  // Per-project remembered worktree/cwd for this page lifetime only.
  const [projectCwds, setProjectCwds] = useState<Map<string, string>>(() => new Map());
  // Ref mirror so handleSelectProject can resolve remembered cwds without
  // depending on projectCwds identity (avoids URL-restore effect loops).
  const projectCwdsRef = useRef(projectCwds);
  projectCwdsRef.current = projectCwds;

  const activateWorkspace = useCallback((cwd: string | null, projectRoot?: string | null) => {
    const nextProject = projectRoot ?? cwd;
    setActiveCwd(cwd);
    setActiveProjectRoot(nextProject);
    if (cwd && nextProject) {
      setProjectCwds((previous) => {
        const next = new Map(previous);
        next.set(nextProject, cwd);
        return next;
      });
    }
  }, []);

  const handleSelectProject = useCallback((projectRoot: string, fallbackCwd: string) => {
    // Resolve remembered cwd immediately from the ref so project-row + and
    // selection do not wait for a React state update of projectCwds.
    activateWorkspace(projectCwdsRef.current.get(projectRoot) ?? fallbackCwd, projectRoot);
  }, [activateWorkspace]);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        activateWorkspace(data.cwd, data.cwd);
        setNewSessionCwd(data.cwd);
        setInitialSessionRestored(true);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
        setInitialSessionRestored(true);
      });

    return () => controller.abort();
  }, [activateWorkspace, initialNavigation]);

  // Update browser tab title when workspace changes
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - Pi Web` : "Pi Web";
  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    const projectRoot = session.projectRoot ?? session.cwd;
    // Persist the session we're leaving before swapping open files (Codex).
    if (activeSessionIdRef.current && activeSessionIdRef.current !== session.id) {
      captureCurrentSessionFilePanel();
    }
    setActiveProjectRoot(projectRoot);
    setActiveCwd(session.cwd);
    setProjectCwds((previous) => {
      const next = new Map(previous);
      next.set(projectRoot, session.cwd);
      return next;
    });
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // Restore this session's Side Chat + open-file panel; never carry another session's files.
    applySessionFilePanel(session.id);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop.
    // Restore does not call activateWorkspace; it writes cwd/projectRoot directly.
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [applySessionFilePanel, captureCurrentSessionFilePanel, router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, fallbackCwd: string, projectRoot = fallbackCwd) => {
    // Resolve remembered cwd immediately from the ref so project-row + uses the
    // last worktree without waiting for React state.
    const cwd = projectCwdsRef.current.get(projectRoot) ?? fallbackCwd;
    captureCurrentSessionFilePanel();
    setActiveProjectRoot(projectRoot);
    setActiveCwd(cwd);
    setProjectCwds((previous) => new Map(previous).set(projectRoot, cwd));
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((value) => value + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    // New composer is not a conversation yet — drop open files (Codex blank thread).
    applySessionFilePanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [applySessionFilePanel, captureCurrentSessionFilePanel, isMobile, router]);

  // Client-built transient SessionInfo (new session / fork) lacks server-computed
  // metadata such as projectRoot. Hydrate it from the session list so later
  // session/project UI has the full record without needing activateWorkspace.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    // Bind any files / panel tabs opened on the blank composer to the new conversation id.
    filePanelBySessionRef.current.set(
      session.id,
      captureSessionFilePanelState({
        tabs: fileTabsRef.current,
        activeTabId: activeFileTabIdRef.current,
        filesSurface: "file",
      }),
    );
    persistRightPanelTabs(session.id, rightPanelTabsRef.current, activeRightPanelTabIdRef.current);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [hydrateSelectedSession, persistRightPanelTabs, router]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleSessionForked = useCallback((newSessionId: string) => {
    // Keep parent's open files under the parent id; fork starts with a copy of the live panel.
    captureCurrentSessionFilePanel();
    filePanelBySessionRef.current.set(
      newSessionId,
      captureSessionFilePanelState({
        tabs: fileTabsRef.current,
        activeTabId: activeFileTabIdRef.current,
        filesSurface: "file",
      }),
    );
    persistRightPanelTabs(newSessionId, rightPanelTabsRef.current, activeRightPanelTabIdRef.current);
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [captureCurrentSessionFilePanel, hydrateSelectedSession, persistRightPanelTabs, router]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      // Drop the panel without re-writing the per-session map entry we are about to delete.
      setFileTabs([]);
      setActiveFileTabId(null);
      setRightPanelTabs([]);
      setActiveRightPanelTabId(null);
      setRightPanelOpen(false);
      setRightPanelMaximized(false);
      router.replace("/", { scroll: false });
    }
    sideChatOpenBySessionRef.current.delete(sessionId);
    filePanelBySessionRef.current.delete(sessionId);
    rightPanelTabsBySessionRef.current.delete(sessionId);
  }, [selectedSession, router]);

  const openRightPanelKind = useCallback((kind: RightPanelTabKind, title?: string) => {
    if (isMobile) setSidebarOpen(false);
    setRightPanelTabs((prev) => {
      const next = openOrFocusRightPanelTab(prev, kind, title);
      setActiveRightPanelTabId(next.activeTabId);
      persistRightPanelTabs(activeSessionIdRef.current, next.tabs, next.activeTabId);
      return next.tabs;
    });
    setRightPanelOpen(true);
  }, [isMobile, persistRightPanelTabs]);

  const handleOpenRightPanelAction = useCallback((action: RightPanelTabAction) => {
    if (action === "terminal" || action === "browser") return;
    if (action === "files" && !activeCwd) return;
    if (action === "sideChat" && !selectedSession) return;
    const kind = actionToTabKind(action);
    if (!kind) return;
    openRightPanelKind(kind);
  }, [activeCwd, openRightPanelKind, selectedSession]);

  const handleSelectRightPanelTab = useCallback((tabId: string) => {
    setActiveRightPanelTabId(tabId);
    persistRightPanelTabs(activeSessionIdRef.current, rightPanelTabsRef.current, tabId);
  }, [persistRightPanelTabs]);

  const handleCloseRightPanelTab = useCallback((tabId: string) => {
    setRightPanelTabs((prev) => {
      const next = closeRightPanelTab(prev, activeRightPanelTabIdRef.current, tabId);
      setActiveRightPanelTabId(next.activeTabId);
      persistRightPanelTabs(activeSessionIdRef.current, next.tabs, next.activeTabId);
      // Codex: last tab closed → empty state; panel stays open.
      if (next.tabs.length === 0) {
        setRightPanelOpen(true);
      }
      return next.tabs;
    });
  }, [persistRightPanelTabs]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff" },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) {
        return [...prev, {
          id: tabId,
          label: fileName,
          filePath,
          sourceSessionId,
          initialDisplayMode: modeHint,
        }];
      }
      const sourceUnchanged = !sourceSessionId || existing.sourceSessionId === sourceSessionId;
      const modeUnchanged = !modeHint || existing.initialDisplayMode === modeHint;
      if (sourceUnchanged && modeUnchanged) return prev;
      return prev.map((t) => {
        if (t.id !== tabId) return t;
        const next: Tab = { ...t };
        if (sourceSessionId) next.sourceSessionId = sourceSessionId;
        if (modeHint) next.initialDisplayMode = modeHint;
        return next;
      });
    });
    setActiveFileTabId(tabId);
    openRightPanelKind("files", fileName);
  }, [openRightPanelKind]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null });
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const toggleExplorerPanel = useCallback(() => {
    if (!activeCwd) return;
    if (isMobile) setSidebarOpen(false);
    const existing = findTabByKind(rightPanelTabsRef.current, "files");
    if (rightPanelOpen && existing && activeRightPanelTabIdRef.current === existing.id) {
      handleCloseRightPanelTab(existing.id);
      return;
    }
    openRightPanelKind("files");
  }, [activeCwd, handleCloseRightPanelTab, isMobile, openRightPanelKind, rightPanelOpen]);

  const toggleSideChatPanel = useCallback(() => {
    if (!selectedSession) return;
    if (isMobile) setSidebarOpen(false);
    const existing = findTabByKind(rightPanelTabsRef.current, "sideChat");
    if (rightPanelOpen && existing && activeRightPanelTabIdRef.current === existing.id) {
      handleCloseRightPanelTab(existing.id);
      return;
    }
    openRightPanelKind("sideChat");
  }, [handleCloseRightPanelTab, isMobile, openRightPanelKind, rightPanelOpen, selectedSession]);

  const toggleRightPanelMaximized = useCallback(() => {
    if (!rightPanelOpen) {
      setRightPanelOpen(true);
      setRightPanelMaximized(true);
      return;
    }
    setRightPanelMaximized((value) => !value);
  }, [rightPanelOpen]);

  /** Codex top-right control: show/hide the right side panel (not the left sidebar). */
  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      closeRightPanel();
      return;
    }
    if (isMobile) setSidebarOpen(false);
    // Re-open shell. Empty tabs → Codex blank home; otherwise restore last tabs.
    setRightPanelOpen(true);
  }, [closeRightPanel, isMobile, rightPanelOpen]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Global keyboard shortcuts (Esc / new session / Codex panel toggles)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd, activeProjectRoot ?? cwd),
    activeCwd,
    onToggleSidebar: handleSidebarToggle,
    onToggleRightPanel: toggleRightPanel,
    onToggleExplorer: toggleExplorerPanel,
    onToggleSideChat: toggleSideChatPanel,
  });

  // Chat appears only for a selected session or an explicitly requested new session.
  const effectiveNewSessionCwd = newSessionCwd;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? activeCwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        activeProjectRoot={activeProjectRoot}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
      />
      <div style={{ padding: "8px", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 4 }}>
        {([
          {
            label: "Models",
            onClick: () => setModelsConfigOpen(true),
            disabled: false,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
            ),
          },
          {
            label: "Skills",
            onClick: () => setSkillsConfigOpen(true),
            disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            ),
          },
          {
            label: "Plugins",
            onClick: () => setPluginsConfigOpen(true),
            disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 7V2" />
                <path d="M15 7V2" />
                <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
                <path d="M12 19v3" />
              </svg>
            ),
          },
        ] as { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]).map(({ label, onClick, disabled, icon }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 32, padding: 0, background: "none", border: "none",
              borderRadius: 9, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
              fontSize: 12, opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(calc(-100% - env(safe-area-inset-left)));
          box-shadow: none;
        }
      }
    `}</style>
    <div style={{
      display: "flex",
      width: "100%",
      height: "var(--app-viewport-height, 100dvh)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      overflow: "hidden",
      background: "var(--bg)",
    }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Codex toolbar: 46px row with icon buttons */}
        <div ref={topBarRef} className="app-top-toolbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, height: "calc(46px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)", paddingInline: 8, gap: 2 }}>
          <button
            onClick={handleSidebarToggle}
            className="app-toolbar-btn"
            title={`${sidebarOpen ? translate("layout.hideSidebar") : translate("layout.showSidebar")} (Ctrl+B)`}
            aria-label={sidebarOpen ? translate("layout.hideSidebar") : translate("layout.showSidebar")}
            aria-pressed={sidebarOpen}
            data-active={sidebarOpen}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="4" width="17" height="16" rx="3" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            className="app-toolbar-btn"
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={isDark}
            data-active={isDark}
          >
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
            <button
              type="button"
              onClick={() => {
                setProjectTrustError(null);
                setProjectTrustDialogOpen(true);
              }}
              className="app-toolbar-btn"
              data-tone="warning"
              data-expanded={!isMobile || undefined}
              title={translate("trust.resourcesNotLoaded")}
              aria-label={translate("trust.resourcesNotLoaded")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              {!isMobile && <span className="app-toolbar-btn-label">{translate("trust.resourcesNotLoaded")}</span>}
            </button>
          )}
          {showChat && (
            <div style={{ display: "flex", alignItems: "center", height: "100%", minWidth: 0, overflow: "hidden" }}>
              <WorktreeSwitcher
                projectRoot={activeProjectRoot}
                cwd={activeCwd}
                onCwdChange={(cwd, projectRoot) => activateWorkspace(cwd, projectRoot)}
              />
              {!isMobile && (
                <button
                  onClick={handleViewFullHistory}
                  disabled={!selectedSession}
                  className="app-toolbar-btn"
                  title={selectedSession ? "View full history" : "Full history is available after the session is saved"}
                  aria-label="View full history"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
              )}
              {!isMobile && (() => {
                const hasMessages = Boolean(
                  selectedSession
                  && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
                );
                const disabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                const isSuccess = autoNameStatus.kind === "success";
                const isError = autoNameStatus.kind === "error";
                const label = autoNameStatus.kind === "naming"
                  ? "Generating..."
                  : isSuccess
                    ? "Title updated"
                    : isError
                      ? "Generation failed"
                      : "Generate title";
                const title = !selectedSession
                  ? "Title generation is available after the session is saved"
                  : !hasMessages
                    ? "Send a message before naming this session"
                    : isError
                      ? autoNameStatus.message
                      : "Generate a session title";

                const showStatusLabel = autoNameStatus.kind !== "idle";
                const tone = isError ? "error" : isSuccess ? "success" : undefined;

                return (
                  <button
                    type="button"
                    onClick={() => void handleAutoName()}
                    disabled={disabled}
                    title={title}
                    aria-label={label}
                    className="app-toolbar-btn"
                    data-tone={tone}
                    data-expanded={showStatusLabel || undefined}
                  >
                    {autoNameStatus.kind === "naming" ? (
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : isSuccess ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isError ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m15 4 5 5L7 22l-5-5Z" />
                        <path d="m14 5 5 5" />
                        <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                      </svg>
                    )}
                    {showStatusLabel && <span className="app-toolbar-btn-label">{label}</span>}
                  </button>
                );
              })()}
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              {!isMobile && (
                <button
                  ref={systemBtnRef}
                  onClick={() => toggleTopPanel("system")}
                  className="app-toolbar-btn"
                  title="System prompt"
                  aria-label="System prompt"
                  aria-pressed={activeTopPanel === "system"}
                  data-active={activeTopPanel === "system"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "currentColor", flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                </button>
              )}
            </div>
          )}
          {/* Session statistics moved to the composer footer. The existing
              session panel remains available and is opened from that footer. */}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      System prompt is empty (tools are disabled)
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      Send a message to load the system prompt
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const sessionRows = [
                      ...(sessionStats.sessionName ? [{ label: "Name", value: sessionStats.sessionName, copyField: null }] : []),
                      { label: "File", value: sessionStats.sessionFile ?? "In-memory", copyField: "file" as const },
                      { label: "ID", value: sessionStats.sessionId, copyField: "id" as const },
                    ];
                    const messageRows = [
                      ["User", sessionStats.userMessages.toLocaleString()],
                      ["Assistant", sessionStats.assistantMessages.toLocaleString()],
                      ["Tool Calls", sessionStats.toolCalls.toLocaleString()],
                      ["Tool Results", sessionStats.toolResults.toLocaleString()],
                      ["Total", sessionStats.totalMessages.toLocaleString()],
                    ];
                    const tokenRows = [
                      ["Input", sessionStats.tokens.input.toLocaleString()],
                      ["Output", sessionStats.tokens.output.toLocaleString()],
                      ...(sessionStats.tokens.cacheRead > 0 ? [["Cache Read", sessionStats.tokens.cacheRead.toLocaleString()]] : []),
                      ...(sessionStats.tokens.cacheWrite > 0 ? [["Cache Write", sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
                      ["Total", sessionStats.tokens.total.toLocaleString()],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                    const extraTokenRows = [
                      ...(sessionStats.cost > 0 ? [["Cost", `$${sessionStats.cost.toFixed(4)}`]] : []),
                      ...(ctx?.contextWindow ? [["Context", `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                          title={copied ? "Copied" : `Copy ${field === "file" ? "file path" : "session ID"}`}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Session Info</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        {sessionInfoSection}
                        {section("Messages", messageRows)}
                        {section("Tokens", [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      Send a message or run /session to load session info
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={toggleSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
              hideMinimap={rightPanelOpen}
            />
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "var(--text)" }}>Opening workspace...</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
              <div style={{ fontSize: 14, color: "#dc2626" }}>Unable to open workspace</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                Select a session from the sidebar
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Get Started</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>Select a project directory from the sidebar<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>Add models via the <strong style={{ color: "var(--text)" }}>Models</strong> button at the bottom
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={closeRightPanel}
      />
      {rightPanelOpen && !rightPanelMaximized && (
        <div
          {...rightPanelResizer.separatorProps}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}
      {/* Right panel shell (Codex: open / width / maximize + content surfaces) */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelMaximized ? " right-panel-maximized" : ""}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": rightPanelMaximized ? "min(100%, max(420px, 100% - 320px))" : `${rightPanelResizer.width}px`,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        } as React.CSSProperties}
      >
        <WorkspaceFilePanel
          open={rightPanelOpen}
          tabs={rightPanelTabs}
          activeTabId={activeRightPanelTabId}
          cwd={activeCwd}
          fileTabs={fileTabs}
          activeFileTabId={activeFileTabId}
          explorerRefreshKey={explorerRefreshKey}
          changesCollapsed={changesCollapsed}
          canOpenSideChat={Boolean(selectedSession)}
          onSelectPanelTab={handleSelectRightPanelTab}
          onClosePanelTab={handleCloseRightPanelTab}
          onOpenAction={handleOpenRightPanelAction}
          onSelectFileTab={setActiveFileTabId}
          onCloseFileTab={handleCloseFileTab}
          onOpenFile={handleOpenFile}
          onAtMention={handleAtMention}
          onAtMentions={handleAtMentions}
          onMentionLines={rightPanelMode === "file" || rightPanelMode === "explorer" ? handleFileLineMention : undefined}
          onChangesCountChange={setChangesCount}
          sideChat={selectedSession ? (
            <SideChatPanel
              key={selectedSession.id}
              active={rightPanelMode === "chat"}
              mainSession={selectedSession}
              onClose={() => {
                const tab = findTabByKind(rightPanelTabsRef.current, "sideChat");
                if (tab) handleCloseRightPanelTab(tab.id);
                else closeRightPanel();
              }}
              onAgentEnd={handleAgentEnd}
              onOpenFile={handleOpenLinkedFile}
            />
          ) : null}
        />
      </div>
    </div>
    {/* Codex right-panel chrome: floating expand + close cluster (top-right) */}
    <div
      className="codex-right-panel-controls"
      style={{
        position: "fixed",
        top: 6,
        right: "calc(10px + env(safe-area-inset-right))",
        zIndex: 320,
        display: "flex",
        alignItems: "center",
        gap: 6,
        pointerEvents: "none",
      }}
    >
      {rightPanelOpen && rightPanelMode === "explorer" && changesCount > 0 && (
        <button
          type="button"
          onClick={() => setChangesCollapsed((value) => !value)}
          title={changesCollapsed ? "Show git changes" : "Hide git changes"}
          aria-label={changesCollapsed ? "Show git changes" : "Hide git changes"}
          aria-pressed={!changesCollapsed}
          className="codex-panel-chip"
          style={{
            pointerEvents: "auto",
            display: "flex", alignItems: "center", justifyContent: "center",
            minWidth: 28, height: 28, padding: "0 8px",
            background: changesCollapsed ? "var(--bg)" : "var(--bg-selected)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            color: changesCollapsed ? "var(--text-dim)" : "var(--accent)",
            cursor: "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {changesCount}
        </button>
      )}

      {rightPanelOpen ? (
        <div
          className="codex-panel-control-cluster"
          style={{
            pointerEvents: "auto",
            display: "inline-flex",
            alignItems: "center",
            height: 30,
            padding: 2,
            gap: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <button
            type="button"
            onClick={toggleRightPanelMaximized}
            title={rightPanelMaximized ? translate("layout.restorePanelWidth") : translate("layout.expandPanel")}
            aria-label={rightPanelMaximized ? translate("layout.restorePanelWidth") : translate("layout.expandPanel")}
            aria-pressed={rightPanelMaximized}
            className="codex-panel-control-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              border: "none",
              borderRadius: 999,
              background: rightPanelMaximized ? "var(--bg-selected)" : "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {rightPanelMaximized ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={closeRightPanel}
            title={`${translate("layout.closePanel")} (Ctrl+Alt+B)`}
            aria-label={translate("layout.closePanel")}
            className="codex-panel-control-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              border: "none",
              borderRadius: 999,
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {/* Codex: panel glyph with corner close mark */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="4" width="17" height="16" rx="3" />
              <path d="M15 4v16" />
              <path d="M17.2 8.2l3.6-3.6" />
              <path d="M20.8 8.2l-3.6-3.6" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleRightPanel}
          title={`${translate("layout.showRightPanel")} (Ctrl+Alt+B)`}
          aria-label={translate("layout.showRightPanel")}
          aria-pressed={false}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            padding: 0,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            color: "var(--text-muted)",
            cursor: "pointer",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="4" width="17" height="16" rx="3" />
            <path d="M15 4v16" />
          </svg>
        </button>
      )}
    </div>
    {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setSkillsConfigOpen(false)} />
    )}
    {pluginsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <PluginsConfig
        cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
        sessionId={selectedSession?.id ?? null}
        onClose={() => setPluginsConfigOpen(false)}
        onReloaded={() => setSessionKey((k) => k + 1)}
      />
    )}
    </>
  );
}
