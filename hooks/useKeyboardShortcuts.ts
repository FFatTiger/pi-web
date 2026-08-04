"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** Codex: Ctrl/Cmd+B toggles the left sidebar. */
  onToggleSidebar?: () => void;
  /** Codex: Ctrl/Cmd+Alt+B toggles the right side panel. */
  onToggleRightPanel?: () => void;
  /** Codex-ish: Ctrl/Cmd+Shift+E toggles file explorer panel. */
  onToggleExplorer?: () => void;
  /** Codex: Ctrl/Cmd+Alt+S opens/toggles side chat. */
  onToggleSideChat?: () => void;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *   Ctrl/Cmd+B   – toggle left sidebar (Codex toggleSidebar)
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const {
    onNewSession,
    activeCwd,
    onToggleSidebar,
    onToggleRightPanel,
    onToggleExplorer,
    onToggleSideChat,
  } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName;
      const inEditable = tag === "TEXTAREA" || tag === "INPUT" || (e.target as HTMLElement)?.isContentEditable;

      // ---- Ctrl/Cmd+B: toggle LEFT sidebar (Codex) ----
      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (!onToggleSidebar || inEditable) return;
        e.preventDefault();
        onToggleSidebar();
        return;
      }

      // ---- Ctrl/Cmd+Alt+B: toggle RIGHT side panel (Codex toggleSidePanel) ----
      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
        if (!onToggleRightPanel || inEditable) return;
        e.preventDefault();
        onToggleRightPanel();
        return;
      }

      // ---- Ctrl/Cmd+Shift+E: toggle explorer (Codex file tree) ----
      if ((e.key === "e" || e.key === "E") && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        if (!onToggleExplorer || inEditable) return;
        e.preventDefault();
        onToggleExplorer();
        return;
      }

      // ---- Ctrl/Cmd+Alt+S: toggle side chat (Codex openSideChat) ----
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
        if (!onToggleSideChat || inEditable) return;
        e.preventDefault();
        onToggleSideChat();
        return;
      }

      // ---- Ctrl+Alt+N: new session ----
      if (e.key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession, onToggleExplorer, onToggleRightPanel, onToggleSideChat, onToggleSidebar]);
}
