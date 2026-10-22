import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { MarkState } from "../marks";
import type { Player } from "../player";
import type { BrandKit, Format, Project } from "../types";
import { Chat } from "./Chat";
import { ChipSelect } from "./ChipSelect";
import { CommentsPanel } from "./Comments";
import { ExportPanel } from "./Export";
import { Icon, type IconName } from "./Icons";
import { MediaPanel } from "./Media";
import { Preview } from "./Preview";
import { SourcesPanel } from "./Sources";
import { Timeline } from "./Timeline";
import { VariablesPanel } from "./Variables";
import { VoicePanel } from "./VoicePanel";

type PanelTab = "media" | "voice" | "variables" | "comments" | "sources";

const PANEL_TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "folder" },
  { id: "voice", label: "Voice & Captions", icon: "captions" },
  { id: "variables", label: "Variables", icon: "sliders" },
  { id: "comments", label: "Comments", icon: "comment" },
  { id: "sources", label: "Sources", icon: "globe" },
];

const PANEL_KEY = "memotion.panel";
const DIRECTOR_KEY = "memotion.director";

function savedOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "closed";
  } catch {
    return true;
  }
}

function remember(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    // not remembered
  }
}

/** The structure and brand kit this video uses, as two chips above the message box. */
function ProjectChips({ project, onProjectChanged, onEdited }: { project: Project; onProjectChanged: () => void; onEdited: () => void }) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [formats, setFormats] = useState<Format[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.brandKits().then(setKits, () => setKits([]));
    void api.formats().then(setFormats, () => setFormats([]));
  }, [project.id]);

  async function change(job: () => Promise<unknown>) {
    setError(null);
    try {
      await job();
      onProjectChanged();
      onEdited();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="project-chips">
      <ChipSelect icon="layout" label="Structure" active={Boolean(project.formatId)} value={project.formatId ?? ""} onChange={(v) => void change(() => api.setFormat(project.id, v === "" ? null : v))} title="How the director structures this video">
        <option value="">Free-form</option>
        {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </ChipSelect>
      <ChipSelect icon="brand" label="Brand kit" active={Boolean(project.brandKitId)} value={project.brandKitId ?? ""} onChange={(v) => void change(() => api.applyBrand(project.id, v === "" ? null : v))} title="Brand kit for this video. Kits are managed on the Brand kits page.">
        <option value="">No brand kit</option>
        {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </ChipSelect>
      {error && <span className="draw-error">{error}</span>}
    </div>
  );
}

/** The project's name; click to rename. */
function ProjectTitle({ project, onRenamed }: { project: Project; onRenamed: (p: Project) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(project.name);
    setEditing(false);
  }, [project.id, project.name]);

  async function save() {
    const name = draft.trim();
    setEditing(false);
    if (name.length === 0 || name === project.name) return setDraft(project.name);
    try {
      onRenamed(await api.renameProject(project.id, name));
      setError(null);
    } catch (e) {
      setDraft(project.name);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return editing ? (
    <input
      className="title-input"
      autoFocus
      value={draft}
      maxLength={80}
      aria-label="Project name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void save();
        else if (e.key === "Escape") {
          setDraft(project.name);
          setEditing(false);
        }
      }}
    />
  ) : (
    <button className="title-btn" onClick={() => setEditing(true)} title="Rename" aria-label={`Project name: ${project.name}. Click to rename`}>
      {project.name}
      {error && <span className="draw-error"> {error}</span>}
    </button>
  );
}

export interface EditorProps {
  project: Project;
  reloadKey: number;
  onReload: () => void;
  player: Player;
  marks: MarkState;
  hasProvider: boolean;
  agentLabel: string;
  openSettings: () => void;
  autoSend: string | null;
  onAutoSent: () => void;
  /** Queue a message for the director (used by Comments and Sources). */
  onAsk: (text: string) => void;
  onProjectChanged: () => void;
  onRenamed: (p: Project) => void;
  onHome: () => void;
}

export function Editor(p: EditorProps) {
  const { project } = p;
  const [tab, setTab] = useState<PanelTab>("media");
  const [panelOpen, setPanelOpen] = useState(() => savedOpen(PANEL_KEY));
  const [directorOpen, setDirectorOpen] = useState(() => savedOpen(DIRECTOR_KEY));
  const [exportOpen, setExportOpen] = useState(false);
  /** Once opened, the export dialog stays mounted (hidden) so a render in progress keeps showing its progress. */
  const [exportSeen, setExportSeen] = useState(false);

  const openComments = p.marks.comments.filter((c) => c.status === "open").length;

  const setOpen = useCallback((open: boolean) => {
    setPanelOpen(open);
    remember(PANEL_KEY, open);
  }, []);
  const setDirector = useCallback((open: boolean) => {
    setDirectorOpen(open);
    remember(DIRECTOR_KEY, open);
  }, []);

  // A message another panel queues (Comments, Sources) is for the director: show it.
  useEffect(() => {
    if (p.autoSend) setDirector(true);
  }, [p.autoSend, setDirector]);

  function pick(id: PanelTab) {
    // Clicking the open tab again folds the panel away.
    if (panelOpen && tab === id) return setOpen(false);
    setTab(id);
    setOpen(true);
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <button className="crumb" onClick={p.onHome}>
          <Icon name="chevron-left" size={16} /> Home
        </button>
        <span className="muted">/</span>
        <ProjectTitle project={project} onRenamed={p.onRenamed} />
        <span className="grow" />
        <span className="badge">{project.orientation === "portrait" ? "9:16" : "16:9"} · {project.fps} fps</span>
        <button
          className="export-btn"
          onClick={() => {
            setExportSeen(true);
            setExportOpen(true);
          }}
        >
          <Icon name="download" size={16} /> Export
        </button>
      </header>

      <div className={`editor-main ${panelOpen ? "" : "panel-closed"} ${directorOpen ? "" : "director-closed"}`}>
        <section className="card director">
          {!directorOpen && (
            <button className="side-tab rail-open" onClick={() => setDirector(true)} title="Show the director" aria-label="Show the director">
              <Icon name="panel-left" size={19} />
            </button>
          )}
          <Chat
            key={project.id}
            project={project}
            onFilesChanged={p.onReload}
            hasProvider={p.hasProvider}
            agentLabel={p.agentLabel}
            marks={p.marks}
            openSettings={p.openSettings}
            autoSend={p.autoSend}
            onAutoSent={p.onAutoSent}
            onCollapse={() => setDirector(false)}
            chips={<ProjectChips project={project} onProjectChanged={p.onProjectChanged} onEdited={p.onReload} />}
          />
        </section>

        <section className="card stage-card">
          <Preview key={project.id} project={project} reloadKey={p.reloadKey} player={p.player} marks={p.marks} />
        </section>

        <aside className="card side-panel" aria-label="Tools">
          <div className="side-tabs" role="tablist" aria-orientation={panelOpen ? "horizontal" : "vertical"}>
            {PANEL_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={panelOpen && tab === t.id} className={`side-tab ${panelOpen && tab === t.id ? "on" : ""}`} onClick={() => pick(t.id)} title={t.label} aria-label={t.label}>
                <Icon name={t.icon} size={19} />
                {t.id === "comments" && openComments > 0 && <span className="count">{openComments}</span>}
              </button>
            ))}
            <span className="grow" />
            <button className="side-tab" onClick={() => setOpen(!panelOpen)} title={panelOpen ? "Hide the tools" : "Show the tools"} aria-label={panelOpen ? "Hide the tools" : "Show the tools"}>
              <Icon name="panel-right" size={19} />
            </button>
          </div>
          {panelOpen && (
            <div className="side-body">
              <h2 className="side-title">{PANEL_TABS.find((t) => t.id === tab)?.label}</h2>
              {tab === "media" && <MediaPanel project={project} onChanged={p.onReload} />}
              {tab === "voice" && <VoicePanel project={project} onEdited={p.onReload} />}
              {tab === "variables" && <VariablesPanel project={project} reloadKey={p.reloadKey} onEdited={p.onReload} />}
              {tab === "comments" && <CommentsPanel project={project} marks={p.marks} onAsk={p.onAsk} onSeek={p.player.seek} />}
              {tab === "sources" && <SourcesPanel project={project} onEdited={p.onReload} onAsk={p.onAsk} openSettings={p.openSettings} />}
            </div>
          )}
        </aside>
      </div>

      <section className="timeline-dock" aria-label="Timeline">
        <Timeline key={project.id} project={project} player={p.player} reloadKey={p.reloadKey} onEdited={p.onReload} />
      </section>

      {exportSeen && (
        <div className="modal-backdrop" hidden={!exportOpen} onMouseDown={() => setExportOpen(false)}>
          <div className="modal small" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
            <div className="modal-head">
              <h2>Export MP4</h2>
              <button onClick={() => setExportOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="form">
              <ExportPanel project={project} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
