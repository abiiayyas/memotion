import { useState } from "react";
import { api } from "../api";
import type { Orientation, Project } from "../types";

export function Sidebar({
  projects,
  currentId,
  onSelect,
  onCreated,
  onDeleted,
  openSettings,
}: {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreated: (p: Project) => void;
  onDeleted: (id: string) => void;
  openSettings: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [fps, setFps] = useState<30 | 60>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createProject(name.trim() || "Untitled video", orientation, fps));
      setCreating(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    if (!window.confirm(`Delete “${p.name}” and all its files? This cannot be undone.`)) return;
    await api.deleteProject(p.id);
    onDeleted(p.id);
  }

  return (
    <aside className="sidebar">
      <div className="brand">Memotion</div>
      {creating ? (
        <form className="new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Video name" />
          <div className="seg" role="radiogroup" aria-label="Format">
            <button type="button" role="radio" aria-checked={orientation === "landscape"} className={orientation === "landscape" ? "on" : ""} onClick={() => setOrientation("landscape")}>
              16:9<small>YouTube, course</small>
            </button>
            <button type="button" role="radio" aria-checked={orientation === "portrait"} className={orientation === "portrait" ? "on" : ""} onClick={() => setOrientation("portrait")}>
              9:16<small>Shorts, Reels</small>
            </button>
          </div>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value) === 60 ? 60 : 30)}>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
          {error && <div className="notice error">{error}</div>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="primary wide" onClick={() => setCreating(true)}>+ New video</button>
      )}
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id} className={p.id === currentId ? "sel" : ""}>
            <button className="proj" onClick={() => onSelect(p.id)}>
              <span>{p.name}</span>
              <small>{p.orientation === "portrait" ? "9:16" : "16:9"} · {p.fps} fps</small>
            </button>
            <button className="x" onClick={() => void remove(p)} aria-label={`Delete ${p.name}`}>✕</button>
          </li>
        ))}
      </ul>
      <button className="settings-btn" onClick={openSettings}>⚙ AI providers</button>
    </aside>
  );
}
