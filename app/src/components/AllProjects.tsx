import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Project } from "../types";
import { ago } from "../projectName";
import { ProjectAvatar } from "./Home";
import { Icon } from "./Icons";

/** Every project, newest first, with the actions that used to hide in the sidebar. */
export function AllProjects({
  projects,
  focusSearch,
  onOpen,
  onDeleted,
}: {
  projects: Project[];
  /** Bumped by the sidebar's search button. */
  focusSearch: number;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ projectId: string; name: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, [focusSearch]);

  const q = query.trim().toLowerCase();
  const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;

  async function remove(p: Project) {
    // window.confirm is not reliable in the desktop webview: ask twice instead.
    if (armed !== p.id) {
      setArmed(p.id);
      setTimeout(() => setArmed((a) => (a === p.id ? null : a)), 3500);
      return;
    }
    setArmed(null);
    setError(null);
    try {
      await api.deleteProject(p.id);
      onDeleted(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveTemplate() {
    if (!saving || !saving.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.saveTemplate(saving.projectId, saving.name.trim(), saving.description.trim());
      setNotice(`Saved template “${t.name}”.`);
      setSaving(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="page-head">
        <h1>All projects</h1>
        <label className="search-field">
          <Icon name="search" size={16} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" aria-label="Search projects" />
        </label>
      </header>
      {notice && <div className="notice okmsg">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      {list.length === 0 ? (
        <div className="muted">{projects.length === 0 ? "No projects yet. Describe a video on Home to make one." : "No project matches."}</div>
      ) : (
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="pl-main" onClick={() => onOpen(p.id)}>
                <ProjectAvatar project={p} size={34} />
                <span className="rc-text">
                  <strong>{p.name}</strong>
                  <small>{p.orientation === "portrait" ? "9:16" : "16:9"} · {p.fps} fps · edited {ago(p.updatedAt)}</small>
                </span>
              </button>
              <button className="pl-act" onClick={() => setSaving({ projectId: p.id, name: p.name, description: "" })} aria-label={`Save ${p.name} as template`} title="Save as template">
                Save as template
              </button>
              <button className={`pl-act ${armed === p.id ? "armed" : ""}`} onClick={() => void remove(p)} aria-label={`Delete ${p.name}`}>
                {armed === p.id ? "Click again to delete" : <Icon name="trash" size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {saving && (
        <div className="modal-backdrop" onMouseDown={() => !busy && setSaving(null)}>
          <form className="modal small" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void saveTemplate(); }} aria-label="Save as template">
            <div className="modal-head"><h2>Save as template</h2></div>
            <div className="form">
              <label>Template name<input value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} required autoFocus /></label>
              <label>What it is for (optional)<input value={saving.description} onChange={(e) => setSaving({ ...saving, description: e.target.value })} /></label>
              <div className="muted">Saves the design, not the narration.</div>
              <div className="row">
                <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => setSaving(null)} disabled={busy}>Cancel</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
