import { Link } from "@tanstack/react-router";
import type { WorkspaceSearch } from "@/lib/search-params";
import { formatCwdLabel } from "@/lib/search-params";

export interface SidebarProps {
  open: boolean;
  search: WorkspaceSearch;
}

/** Placeholder sessions until HTTP /v1/sessions is wired. */
const PLACEHOLDER_SESSIONS = [
  { id: "demo-session-alpha", title: "Scaffold client shell" },
  { id: "demo-session-beta", title: "Readonly history walk" },
] as const;

export function Sidebar({ open, search }: SidebarProps) {
  return (
    <aside
      className={`sidebar${open ? "" : " sidebar--collapsed"}`}
      aria-hidden={!open}
      aria-label="Sessions"
    >
      <div className="sidebar-section">
        <div className="sidebar-section-title">Project</div>
        <div className="sidebar-cwd" title={search.cwd ?? ""}>
          {formatCwdLabel(search.cwd)}
        </div>
      </div>

      <div className="sidebar-section sidebar-section--grow">
        <div className="sidebar-section-title">Sessions</div>
        <ul className="session-list">
          {PLACEHOLDER_SESSIONS.map((session) => {
            const active = search.session === session.id;
            return (
              <li key={session.id}>
                <Link
                  to="/"
                  search={{
                    session: session.id,
                    cwd: search.cwd,
                  }}
                  className={`session-row${active ? " session-row--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="session-row-title">{session.title}</span>
                  <span className="session-row-id">{session.id}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="sidebar-hint">
          Demo list only. Live data will use TanStack Query → HTTP /v1/sessions.
        </p>
      </div>
    </aside>
  );
}
