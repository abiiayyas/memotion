import { useEffect, useState } from "react";
import { api, templateThumbUrl } from "../api";
import logoMark from "../assets/logo-mark.png";
import type { FileVariables, Format, Orientation, Project, TemplateInfo, Variable, VariableFill, VariableValue } from "../types";

function FillField({ v, value, onChange }: { v: Variable; value: VariableValue; onChange: (value: VariableValue) => void }) {
  switch (v.type) {
    case "boolean":
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "enum":
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(v.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
        </select>
      );
    case "color":
      return <input type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 28, padding: 0 }} />;
    case "number":
      return <input type="number" value={Number(value)} min={v.min} max={v.max} step={v.step} onChange={(e) => onChange(Number(e.target.value))} />;
    case "string":
      return <input value={String(value)} maxLength={v.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
}

function Thumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void templateThumbUrl(id).then(setSrc);
  }, [id]);
  return src ? <img src={src} alt="" className="tpl-thumb" /> : null;
}

export function Sidebar({
  projects,
  currentId,
  onSelect,
  onCreated,
  onDeleted,
  openSettings,
  openImport,
}: {
  projects: Project[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreated: (p: Project) => void;
  onDeleted: (id: string) => void;
  openSettings: () => void;
  openImport: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [fps, setFps] = useState<30 | 60>(30);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [formats, setFormats] = useState<Format[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [formatId, setFormatId] = useState("");
  const [tplVars, setTplVars] = useState<FileVariables[]>([]);
  const [fills, setFills] = useState<Record<string, VariableValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ projectId: string; name: string; description: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!creating) return;
    void api.templates().then(setTemplates, () => setTemplates([]));
    void api.formats().then(setFormats, () => setFormats([]));
  }, [creating]);

  useEffect(() => {
    setFills({});
    if (!templateId) {
      setTplVars([]);
      return;
    }
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

  const template = templates.find((t) => t.id === templateId);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const title = name.trim() || template?.name || "Untitled video";
      let project: Project;
      if (template) {
        // Send only what the user changed from the template's own defaults.
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
      onCreated({ ...project, formatId: formatId || undefined });
      setCreating(false);
      setName("");
      setTemplateId("");
      setFormatId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    if (armed !== p.id) {
      setArmed(p.id);
      setTimeout(() => setArmed((a) => (a === p.id ? null : a)), 3500);
      return;
    }
    setArmed(null);
    await api.deleteProject(p.id);
    onDeleted(p.id);
  }

  async function saveTemplate() {
    if (!saving || !saving.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.saveTemplate(saving.projectId, saving.name.trim(), saving.description.trim());
      setNotice(`Saved template “${t.name}”.`);
      setSaving(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand-head">
        <img className="brand-logo" src={logoMark} alt="" />
        Memotion
      </div>
      {creating ? (
        <form className="new" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={template ? template.name : "Video name"} />
          <label className="field">
            Start from
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.orientation === "portrait" ? "9:16" : "16:9"}</option>)}
            </select>
          </label>
          {template ? (
            <>
              {template.hasThumb && <Thumb id={template.id} />}
              {template.description && <div className="muted">{template.description}</div>}
              {tplVars.flatMap((g) => g.variables.map((v) => (
                <label key={`${g.file}${v.id}`} className="field">
                  {v.label ?? v.id}
                  <FillField v={v} value={fills[`${g.file}\u0000${v.id}`] ?? v.default} onChange={(value) => setFills((f) => ({ ...f, [`${g.file}\u0000${v.id}`]: value }))} />
                </label>
              )))}
            </>
          ) : (
            <>
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
            </>
          )}
          <label className="field">
            Structure
            <select
              value={formatId}
              onChange={(e) => {
                setFormatId(e.target.value);
                const f = formats.find((x) => x.id === e.target.value);
                if (f?.orientation && !template) setOrientation(f.orientation);
              }}
            >
              <option value="">Free-form</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {error && <div className="notice error">{error}</div>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <button className="primary wide" onClick={() => setCreating(true)}>+ New video</button>
          <button className="wide" onClick={openImport}>Import project…</button>
        </>
      )}
      {notice && <div className="notice okmsg">{notice}</div>}
      {!creating && error && <div className="notice error">{error}</div>}
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id} className={p.id === currentId ? "sel" : ""}>
            <button className="proj" onClick={() => onSelect(p.id)}>
              <span>{p.name}</span>
              <small>{p.orientation === "portrait" ? "9:16" : "16:9"} · {p.fps} fps</small>
            </button>
            <button className="x" onClick={() => setSaving({ projectId: p.id, name: p.name, description: "" })} aria-label={`Save ${p.name} as template`} title="Save as template">⧉</button>
            <button className={`x ${armed === p.id ? "armed" : ""}`} onClick={() => void remove(p)} aria-label={`Delete ${p.name}`}>{armed === p.id ? "Sure?" : "✕"}</button>
          </li>
        ))}
      </ul>
      {saving && (
        <form className="new" onSubmit={(e) => { e.preventDefault(); void saveTemplate(); }}>
          <strong>Save as template</strong>
          <input value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} placeholder="Template name" required />
          <input value={saving.description} onChange={(e) => setSaving({ ...saving, description: e.target.value })} placeholder="What it is for (optional)" />
          <div className="muted">Saves the design, not the narration.</div>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setSaving(null)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
      <button className="settings-btn" onClick={openSettings}>⚙ Settings</button>
    </aside>
  );
}
