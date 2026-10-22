import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { BrandKit, Format, Project } from "../types";
import { BLANK, KitEditor, toEditing, type Editing } from "./KitEditor";

/** The video's own choices: how the director structures it, and which brand kit it uses. Kits are managed on the Brand kits page. */
export function BrandPanel({ project, onProjectChanged, onEdited }: { project: Project; onProjectChanged: () => void; onEdited: () => void }) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [formats, setFormats] = useState<Format[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [k, f] = await Promise.all([api.brandKits(), api.formats()]);
      setKits(k);
      setFormats(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const chooseKit = (kitId: string) =>
    run(async () => {
      await api.applyBrand(project.id, kitId === "" ? null : kitId);
      onProjectChanged();
      setNotice(kitId === "" ? "Brand removed from this video." : "Brand applied. The director will use it from the next message.");
    });
  const chooseFormat = (formatId: string) =>
    run(async () => {
      await api.setFormat(project.id, formatId === "" ? null : formatId);
      onProjectChanged();
    });

  return (
    <div className="brand">
      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice okmsg">{notice}</div>}

      <div className="row" style={{ alignItems: "flex-end" }}>
        <label>
          Format (how the director structures the video)
          <select value={project.formatId ?? ""} onChange={(e) => void chooseFormat(e.target.value)} disabled={busy}>
            <option value="">None: free-form</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <label>
          Brand kit for this video
          <select value={project.brandKitId ?? ""} onChange={(e) => void chooseKit(e.target.value)} disabled={busy}>
            <option value="">None</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setEditing({ draft: { ...BLANK }, isNew: true })} disabled={busy}>New kit</button>
        {kits.length > 0 && (
          <select value="" onChange={(e) => { const k = kits.find((x) => x.id === e.target.value); if (k) setEditing(toEditing(k)); }} aria-label="Edit a kit">
            <option value="">Edit a kit…</option>
            {kits.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        )}
      </div>
      {formats.find((f) => f.id === project.formatId)?.description && <div className="muted">{formats.find((f) => f.id === project.formatId)?.description}</div>}

      {editing && (
        <KitEditor
          editing={editing}
          onEditing={setEditing}
          kits={kits}
          refresh={refresh}
          onSaved={async (id) => {
            // The project holds copies of the logo and fonts: refresh them if this is its kit.
            if (project.brandKitId === id) {
              await api.applyBrand(project.id, id);
              onEdited();
            }
          }}
          onRemoved={async (id) => {
            if (project.brandKitId === id) await api.applyBrand(project.id, null);
            onProjectChanged();
          }}
        />
      )}
    </div>
  );
}
