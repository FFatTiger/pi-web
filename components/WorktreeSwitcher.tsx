"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeResponse {
  projectRoot?: string;
  isGit?: boolean;
  isTopLevel?: boolean;
  worktrees?: WorktreeEntry[];
  error?: string;
}

interface WorktreeSwitcherProps {
  projectRoot: string | null;
  cwd: string | null;
  onCwdChange: (cwd: string, projectRoot: string) => void;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the trailing segments visible.
 * rtl container moves the ellipsis to the left edge; plaintext isolation keeps
 * the path rendered left-to-right.
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
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

export function WorktreeSwitcher({ projectRoot, cwd, onCwdChange }: WorktreeSwitcherProps) {
  const [data, setData] = useState<WorktreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOpen(false);
    setNewOpen(false);
    setBranch("");
    setError(null);
    setConfirmRemove(null);
  }, [projectRoot]);

  useLayoutEffect(() => {
    if (!cwd || !projectRoot) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`)
      .then(async (response) => {
        const body = await response.json() as WorktreeResponse;
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((failure) => {
        if (!cancelled) {
          setData(null);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cwd, projectRoot, refreshKey]);

  const createWorktree = useCallback(async () => {
    const nextBranch = branch.trim();
    if (!nextBranch || busy || !projectRoot) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectRoot, branch: nextBranch }),
      });
      const body = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok || !body.path) throw new Error(body.error ?? `HTTP ${response.status}`);
      setBranch("");
      setNewOpen(false);
      setOpen(false);
      onCwdChange(body.path, projectRoot);
      setRefreshKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [branch, busy, onCwdChange, projectRoot]);

  const removeWorktree = useCallback(async (path: string, force: boolean) => {
    if (busy || !projectRoot) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectRoot, path, force }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!response.ok) {
        if (body.dirty && !force) {
          setConfirmRemove(path);
          return;
        }
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setConfirmRemove(null);
      if (cwd === path) onCwdChange(projectRoot, projectRoot);
      setRefreshKey((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, cwd, onCwdChange, projectRoot]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNewOpen(false);
        setBranch("");
        setError(null);
        setConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const enabled = Boolean(data?.isGit && data.isTopLevel && projectRoot && cwd);
  const current = data?.worktrees?.find((item) => item.path === cwd)
    ?? data?.worktrees?.find((item) => item.isMain)
    ?? null;
  const label = loading
    ? "Worktrees…"
    : current?.branch ?? current?.path ?? "Worktree";
  const disabledTitle = loading
    ? "Checking worktrees for this directory"
    : data?.isGit
      ? "Open a Git repository root to manage worktrees"
      : "Worktrees are available in Git repositories";

  const worktrees = data?.worktrees ?? [];

  return (
    <div ref={rootRef} style={{ position: "relative", height: "100%", display: "flex", alignItems: "stretch", minWidth: 0, flexShrink: 1 }}>
      <button
        type="button"
        disabled={!enabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={enabled ? `Switch worktree: ${label}` : disabledTitle}
        title={enabled ? (current ? `Switch worktree: ${current.path}` : "Switch worktree") : disabledTitle}
        onClick={() => {
          if (!enabled) return;
          setOpen((value) => !value);
        }}
        style={{
          height: "100%",
          maxWidth: 220,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
          border: "none",
          borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
          borderRight: "1px solid var(--border)",
          background: open ? "var(--bg-selected)" : "none",
          color: enabled ? "var(--text-muted)" : "var(--text-dim)",
          cursor: enabled ? "pointer" : "not-allowed",
          fontSize: 12,
          lineHeight: 1.35,
          textAlign: "left",
          opacity: enabled ? 1 : 0.82,
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, color: current && !current.isMain ? "var(--accent)" : "var(--text-dim)" }}
          aria-hidden="true"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <PathLabel
          text={label}
          style={{ flex: 1, fontFamily: "var(--font-mono)", color: enabled ? "var(--text)" : "var(--text-dim)" }}
        />
        {enabled && current?.isMain && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>
        )}
        {enabled && worktrees.length > 1 && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
            {worktrees.length}
          </span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <AnimatedDropdown
        open={open && enabled}
        style={{
          position: "absolute",
          top: "100%",
          left: 0,
          minWidth: 260,
          zIndex: 310,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
        <div role="listbox" aria-label="Worktrees" style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
          {worktrees.map((wt) => {
            const isCurrent = wt.path === cwd || (wt.isMain && !worktrees.some((item) => item.path === cwd));
            if (confirmRemove === wt.path) {
              return (
                <div
                  key={wt.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 10px",
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(239,68,68,0.06)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Uncommitted changes. Force remove checkout?
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeWorktree(wt.path, true)}
                    disabled={busy}
                    aria-label={`Force remove worktree ${wt.path}`}
                    style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}
                  >
                    Force
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(null)}
                    aria-label="Cancel force remove"
                    style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                  >
                    Cancel
                  </button>
                </div>
              );
            }
            return (
              <div
                key={wt.path}
                className="wt-row"
                style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => {
                    if (projectRoot) onCwdChange(wt.path, projectRoot);
                    setOpen(false);
                    setError(null);
                  }}
                  title={wt.path}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 10px",
                    background: "var(--bg)",
                    border: "none",
                    color: isCurrent ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {isCurrent ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  ) : (
                    <span style={{ width: 10, flexShrink: 0 }} />
                  )}
                  <PathLabel text={wt.branch ?? wt.path} style={{ flex: 1 }} />
                  {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>main</span>}
                </button>
                {!wt.isMain && (
                  <button
                    type="button"
                    onClick={() => void removeWorktree(wt.path, false)}
                    disabled={busy}
                    title={`Remove worktree checkout ${wt.path}; the branch is kept`}
                    aria-label={`Remove worktree ${wt.path}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 34, height: 28, padding: 0, marginRight: 4,
                      background: "none", border: "none",
                      color: "var(--text-dim)", cursor: busy ? "not-allowed" : "pointer",
                      borderRadius: 5, flexShrink: 0,
                      transition: "color 0.12s, background 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (busy) return;
                      e.currentTarget.style.color = "#ef4444";
                      e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--text-dim)";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!newOpen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setNewOpen(true);
              setError(null);
              setTimeout(() => branchInputRef.current?.focus(), 0);
            }}
            title="Create a worktree checkout for a branch"
            aria-label="Create a new worktree"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              width: "100%",
              padding: "8px 10px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 11,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden="true">
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            <span>New worktree…</span>
          </button>
        ) : (
          <div style={{ padding: "6px 8px" }}>
            <input
              ref={branchInputRef}
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createWorktree();
                }
                if (e.key === "Escape") {
                  setNewOpen(false);
                  setBranch("");
                  setError(null);
                }
              }}
              placeholder="branch name"
              aria-label="New worktree branch name"
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
            <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
              <button
                type="button"
                onClick={() => void createWorktree()}
                disabled={busy || !branch.trim()}
                aria-label="Create worktree"
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: busy || !branch.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !branch.trim() ? 0.65 : 1,
                }}
              >
                {busy ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => { setNewOpen(false); setBranch(""); setError(null); }}
                aria-label="Cancel new worktree"
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
        )}
        {error && (
          <div
            role="alert"
            style={{
              padding: "5px 10px 8px",
              color: "#dc2626",
              fontSize: 11,
              lineHeight: 1.35,
              overflowWrap: "anywhere",
            }}
          >
            {error}
          </div>
        )}
      </AnimatedDropdown>
    </div>
  );
}
