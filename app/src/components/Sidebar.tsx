import logoMark from "../assets/logo-mark.png";
import type { Project } from "../types";
import { Icon } from "./Icons";
import { ProjectAvatar } from "./Home";

export type View = "home" | "brand-kits" | "projects" | "project";

/** How many projects the sidebar lists; the rest are one click away under "All projects". */
export const SIDEBAR_PROJECTS = 6;

export function Sidebar({
  projects,
  view,
  currentId,
  collapsed,
  lockedRail,
  onToggle,
  onHome,
  onBrandKits,
  onAllProjects,
  onSearch,
  onSelect,
  onDelete,
  openSettings,
  openImport,
}: {
  projects: Project[];
  view: View;
  currentId: string | null;
  collapsed: boolean;
  /** The editor needs the room: the sidebar stays a rail there, so there is nothing to toggle. */
  lockedRail: boolean;
  onToggle: () => void;
  onHome: () => void;
  onBrandKits: () => void;
  onAllProjects: () => void;
  onSearch: () => void;
  onSelect: (id: string) => void;
  /** Ask to delete a project (the app shows the confirmation). */
  onDelete: (project: Project) => void;
  openSettings: () => void;
  openImport: () => void;
}) {
  const shown = projects.slice(0, SIDEBAR_PROJECTS);
  // The open project is always listed, even when it is older than the first few.
  const open = currentId !== null && view === "project" ? projects.find((p) => p.id === currentId) : undefined;
  const list = open && !shown.some((p) => p.id === open.id) ? [open, ...shown.slice(0, SIDEBAR_PROJECTS - 1)] : shown;

  return (
    <aside className={`sidebar ${collapsed ? "rail" : ""}`} aria-label="Navigation">
      <div className="side-top">
        <div className="brand-head">
          <img className="brand-logo" src={logoMark} alt="" />
          {!collapsed && <span>Memotion</span>}
        </div>
      </div>

      <div className="side-tools">
        {!lockedRail && (
          <button className="icon-btn" onClick={onToggle} aria-label={collapsed ? "Show the sidebar" : "Hide the sidebar"} title={collapsed ? "Show the sidebar" : "Hide the sidebar"}>
            <Icon name="sidebar" />
          </button>
        )}
        <button className="icon-btn" onClick={onSearch} aria-label="Search projects" title="Search projects">
          <Icon name="search" />
        </button>
        <button className="icon-btn" onClick={onHome} aria-label="New video" title="New video">
          <Icon name="plus" />
        </button>
      </div>

      <nav className="side-nav">
        <button className={`nav-item ${view === "home" ? "on" : ""}`} onClick={onHome} title="Home" aria-current={view === "home" ? "page" : undefined}>
          <Icon name="home" />
          {!collapsed && <span>Home</span>}
        </button>
        <button className={`nav-item ${view === "brand-kits" ? "on" : ""}`} onClick={onBrandKits} title="Brand kits" aria-current={view === "brand-kits" ? "page" : undefined}>
          <Icon name="brand" />
          {!collapsed && <span>Brand kits</span>}
        </button>
      </nav>

      {!collapsed && <div className="side-heading">Projects</div>}
      <ul className="side-projects">
        {list.map((p) => (
          <li key={p.id}>
            <button className={`nav-item ${view === "project" && p.id === currentId ? "on" : ""}`} onClick={() => onSelect(p.id)} title={p.name} aria-current={view === "project" && p.id === currentId ? "page" : undefined}>
              <ProjectAvatar project={p} size={22} />
              {!collapsed && <span className="ellipsis">{p.name}</span>}
            </button>
            {!collapsed && (
              <button className="side-del" onClick={() => onDelete(p)} aria-label={`Delete ${p.name}`} title="Delete project">
                <Icon name="trash" size={15} />
              </button>
            )}
          </li>
        ))}
        <li>
          <button className={`nav-item ${view === "projects" ? "on" : ""}`} onClick={onAllProjects} title={`All projects (${projects.length})`}>
            <Icon name="grid" />
            {!collapsed && <span>All projects ({projects.length})</span>}
          </button>
        </li>
      </ul>

      <div className="side-foot">
        <button className="nav-item" onClick={openImport} title="Import project…">
          <Icon name="import" />
          {!collapsed && <span>Import project…</span>}
        </button>
        <button className="nav-item" onClick={openSettings} title="Settings">
          <Icon name="settings" />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
}
