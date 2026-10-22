import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../api";
import { ago, avatarHue, nameFromPrompt } from "../projectName";
import type { AgentBackend, AgentsInfo, BrandKit, FileVariables, Format, Orientation, Project, TemplateInfo, VariableFill, VariableValue } from "../types";
import { FillField, TemplateThumb } from "./TemplateFill";
import { ChipSelect } from "./ChipSelect";
import { Icon } from "./Icons";

const inTauri = "__TAURI_INTERNALS__" in window;
const MEDIA_EXT = ["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "mov", "webm", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "flac", "ttf", "otf", "woff", "woff2"];
const MAX_FILES = 50;

const base = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export function ProjectAvatar({ project, size = 28 }: { project: Pick<Project, "id" | "name">; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.46, background: `hsl(${avatarHue(project.id)} 62% 46%)` }} aria-hidden="true">
      {project.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export interface HomeProps {
  projects: Project[];
  hasProvider: boolean;
  /** Who writes the video, as last read from the app (Settings can change it). */
  backend: AgentBackend;
  openSettings: () => void;
  onBackendChanged: () => void;
  onOpen: (id: string) => void;
  onShowAll: () => void;
  /** The project exists and its marks are set; the prompt is sent to its director. */
  onStarted: (project: Project, prompt: string) => void;
}

export function Home({ projects, hasProvider, backend: appBackend, openSettings, onBackendChanged, onOpen, onShowAll, onStarted }: HomeProps) {
  const [text, setText] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [fps, setFps] = useState<30 | 60>(30);
  const [formatId, setFormatId] = useState("");
  const [kitId, setKitId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [caret, setCaret] = useState(0);

  const [formats, setFormats] = useState<Format[]>([]);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [agents, setAgents] = useState<AgentsInfo | null>(null);
  const [tplVars, setTplVars] = useState<FileVariables[]>([]);
  const [fills, setFills] = useState<Record<string, VariableValue>>({});
  const [showFills, setShowFills] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api.formats().then(setFormats, () => setFormats([]));
    void api.brandKits().then(setKits, () => setKits([]));
    void api.templates().then(setTemplates, () => setTemplates([]));
    void api.agents().then(setAgents, () => setAgents(null));
    area.current?.focus();
  }, []);

  useEffect(() => setAgents((cur) => (cur ? { ...cur, backend: appBackend } : cur)), [appBackend]);

  const template = templates.find((t) => t.id === templateId);

  // A template fixes the shape of the video; its variables become fields.
  useEffect(() => {
    setFills({});
    setShowFills(false);
    if (!templateId) return setTplVars([]);
    void api.templateVariables(templateId).then(
      (groups) => {
        setTplVars(groups);
        const initial: Record<string, VariableValue> = {};
        for (const g of groups) for (const v of g.variables) initial[`${g.file}\u0000${v.id}`] = v.default;
        setFills(initial);
      },
      () => setTplVars([]),
    );
  }, [templateId]);
  useEffect(() => {
    if (template) {
      setOrientation(template.orientation);
      setFps(template.fps);
    }
  }, [template]);

  const addFiles = useCallback((paths: string[]) => {
    setFiles((cur) => {
      const next = [...cur];
      for (const p of paths) if (!next.includes(p) && next.length < MAX_FILES) next.push(p);
      return next;
    });
  }, []);

  // Files dropped on the window arrive as absolute paths via Tauri.
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop") addFiles(e.payload.paths);
      })
      .then((u) => (off = u));
    return () => off?.();
  }, [addFiles]);

  async function chooseFiles() {
    const picked = await open({ multiple: true, filters: [{ name: "Media", extensions: MEDIA_EXT }] });
    if (Array.isArray(picked)) addFiles(picked);
    else if (typeof picked === "string") addFiles([picked]);
  }

  // "@name" mentions: offered only for files already attached.
  const mention = useMemo(() => {
    const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    return m ? { query: (m[2] ?? "").toLowerCase(), start: caret - (m[2] ?? "").length - 1 } : null;
  }, [text, caret]);
  const mentionItems = mention ? files.filter((f) => base(f).toLowerCase().includes(mention.query)) : [];

  function insertMention(file: string) {
    if (!mention) return;
    const name = base(file);
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    const at = mention.start + name.length + 2;
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  async function changeBackend(value: string) {
    try {
      await api.setAgentBackend(value as AgentBackend);
      setAgents((cur) => (cur ? { ...cur, backend: value as AgentBackend } : cur));
      onBackendChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const backend = agents?.backend ?? "api";
  const canSend = text.trim().length > 0 && hasProvider && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const title = nameFromPrompt(text, template?.name);
      let project: Project;
      if (template) {
        const changed: VariableFill[] = [];
        for (const g of tplVars) {
          for (const v of g.variables) {
            const value = fills[`${g.file}\u0000${v.id}`];
            if (value !== undefined && value !== v.default) changed.push({ file: g.file, id: v.id, value });
          }
        }
        project = await api.createFromTemplate(template.id, title, changed);
      } else {
        project = await api.createProject(title, orientation, fps);
      }
      if (formatId) await api.setFormat(project.id, formatId);
      if (kitId) await api.applyBrand(project.id, kitId);

      let prompt = text.trim();
      if (files.length > 0) {
        const res = await api.importMedia(project.id, files);
        // The director sees real project paths, not the names the user typed after "@".
        for (const m of res.imported) {
          const name = base(m.path);
          const original = files.find((f) => base(f) === name);
          if (original) prompt = prompt.replaceAll(`@${base(original)}`, m.path);
        }
        if (res.imported.length > 0) prompt += `\n\nMedia I attached: ${res.imported.map((m) => m.path).join(", ")}`;
        if (res.failed.length > 0) prompt += `\n\n(Could not import: ${res.failed.map((f) => `${base(f.path)} (${f.error})`).join("; ")})`;
      }
      onStarted({ ...project, formatId: formatId || undefined, brandKitId: kitId || undefined }, prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const recent = projects.slice(0, 6);
  const providerName = "AI provider";

  return (
    <main className="home">
      <h1>Make something.</h1>

      <form
        className="prompt-box"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={area}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (mention && mentionItems.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              insertMention(mentionItems[0] ?? "");
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Describe your video. Type @ to mention media."
          disabled={busy}
          aria-label="Describe your video"
        />
        {mention && (
          <div className="mention-menu" role="listbox">
            {mentionItems.length === 0 ? (
              <div className="muted">{files.length === 0 ? "No media yet. Use + Add first." : "No attached file matches."}</div>
            ) : (
              mentionItems.map((f) => (
                <button type="button" key={f} role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); insertMention(f); }}>
                  {base(f)}
                </button>
              ))
            )}
          </div>
        )}
        {files.length > 0 && (
          <div className="file-chips">
            {files.map((f) => (
              <span key={f} className="file-chip" title={f}>
                <span>{base(f)}</span>
                <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x !== f))} aria-label={`Remove ${base(f)}`} disabled={busy}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="prompt-bar">
          <div className="prompt-chips">
            <button type="button" className="pill" onClick={() => setAdding((a) => !a)} disabled={busy} aria-expanded={adding}>
              <Icon name="plus" size={15} /> Add
            </button>
            <div className="seg-pill" role="radiogroup" aria-label="Video shape">
              {(["landscape", "portrait"] as const).map((o) => (
                <button type="button" key={o} role="radio" aria-checked={orientation === o} className={orientation === o ? "on" : ""} onClick={() => setOrientation(o)} disabled={busy || template !== undefined} title={template ? "Set by the template" : undefined}>
                  {o === "landscape" ? "16:9" : "9:16"}
                </button>
              ))}
            </div>
            <ChipSelect icon="layout" label="Structure" active={formatId !== ""} value={formatId} onChange={(v) => { setFormatId(v); const f = formats.find((x) => x.id === v); if (f?.orientation && !template) setOrientation(f.orientation); }} disabled={busy} title="How the director structures the video">
              <option value="">Free-form</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </ChipSelect>
            <ChipSelect icon="brand" label="Brand kit" active={kitId !== ""} value={kitId} onChange={setKitId} disabled={busy}>
              <option value="">No brand kit</option>
              {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </ChipSelect>
            <ChipSelect icon="template" label="Template" active={templateId !== ""} value={templateId} onChange={setTemplateId} disabled={busy}>
              <option value="">No template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </ChipSelect>
            <ChipSelect icon="film" label="Frame rate" active={fps === 60} value={String(fps)} onChange={(v) => setFps(v === "60" ? 60 : 30)} disabled={busy || template !== undefined}>
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </ChipSelect>
          </div>
          <div className="prompt-send">
            <ChipSelect icon="agent" label="Who writes the video" active={backend !== "api"} value={backend} onChange={(v) => void changeBackend(v)} disabled={busy || agents === null} title="Who writes the video">
              <option value="api">{providerName}</option>
              {agents?.clis.filter((c) => c.id !== "agy" && c.found && !c.unsupported).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </ChipSelect>
            <button type="submit" className="send-round" disabled={!canSend} aria-label="Start the video">
              <Icon name="arrow-up" size={18} />
            </button>
          </div>
        </div>
        {adding && (
          <div className="add-pop">
            <div className="row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
              <input value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} placeholder="/path/to/image-video-or-audio" aria-label="Path of a media file" spellCheck={false}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (pathDraft.trim()) { addFiles([pathDraft.trim()]); setPathDraft(""); } } }} />
              <button type="button" onClick={() => { if (pathDraft.trim()) { addFiles([pathDraft.trim()]); setPathDraft(""); } }} disabled={!pathDraft.trim()}>Add</button>
              {inTauri && <button type="button" onClick={() => void chooseFiles()}>Choose files…</button>}
            </div>
            <small className="muted">Images, video, audio and fonts. They are copied into the new project when you start.{inTauri ? " You can also drop files on the window." : ""}</small>
          </div>
        )}
      </form>

      {template && (
        <section className="tpl-card">
          {template.hasThumb && <TemplateThumb id={template.id} className="tpl-thumb small" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{template.name}</strong>
            {template.description && <div className="muted">{template.description}</div>}
            {tplVars.length > 0 && (
              <button type="button" className="link" onClick={() => setShowFills((s) => !s)}>{showFills ? "Hide" : "Customize"} template fields</button>
            )}
            {showFills && (
              <div className="fill-grid">
                {tplVars.flatMap((g) => g.variables.map((v) => (
                  <label key={`${g.file}${v.id}`} className="field">
                    {v.label ?? v.id}
                    <FillField v={v} value={fills[`${g.file}\u0000${v.id}`] ?? v.default} onChange={(value) => setFills((f) => ({ ...f, [`${g.file}\u0000${v.id}`]: value }))} />
                  </label>
                )))}
              </div>
            )}
          </div>
        </section>
      )}

      {error && <div className="notice error home-note">{error}</div>}
      {!hasProvider && (
        <div className="notice warn home-note">
          {backend === "api" ? "No AI provider is connected yet." : "The chosen coding agent is not available."}{" "}
          <button type="button" className="link" onClick={openSettings}>Choose who writes the video</button>
        </div>
      )}

      <section className="recent" aria-label="Recent projects">
        <div className="recent-head">
          <h2>Recent projects</h2>
          {projects.length > recent.length && <button type="button" className="link" onClick={onShowAll}>All projects ({projects.length})</button>}
        </div>
        {recent.length === 0 ? (
          <div className="muted">Your projects will appear here.</div>
        ) : (
          <div className="recent-grid">
            {recent.map((p) => (
              <button type="button" key={p.id} className="recent-card" onClick={() => onOpen(p.id)}>
                <ProjectAvatar project={p} size={34} />
                <span className="rc-text">
                  <strong>{p.name}</strong>
                  <small>{p.orientation === "portrait" ? "9:16" : "16:9"} · {p.fps} fps · {ago(p.updatedAt)}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
