import { useCallback, useEffect, useState } from "react";
import { api, brandLogoUrl } from "../api";
import type { BrandKit } from "../types";
import { BLANK, KitEditor, toEditing, type Editing } from "./KitEditor";
import { Icon } from "./Icons";

function KitLogo({ kit }: { kit: BrandKit }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (kit.logo) void brandLogoUrl(kit.id, kit.logo + kit.customFonts.length).then(setSrc);
  }, [kit.id, kit.logo, kit.customFonts.length]);
  return src ? <img src={src} alt="" className="kit-logo" /> : <span className="kit-logo ph">{kit.name.charAt(0).toUpperCase()}</span>;
}

/** Brand kits live here, apart from any one video; a video picks one on Home or in its own settings. */
export function BrandKits({ onChanged }: { onChanged: () => void }) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Changes when the user opens a different kit, so the editor starts clean; saving does not change it. */
  const [session, setSession] = useState(0);
  const open = (e: Editing) => {
    setSession((n) => n + 1);
    setEditing(e);
  };
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setKits(await api.brandKits());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Brand kits</h1>
        <button className="primary" onClick={() => open({ draft: { ...BLANK }, isNew: true })}>
          <Icon name="plus" size={15} /> New kit
        </button>
      </header>
      <p className="muted lead">Colours, fonts, a logo and a tone of voice. Pick a kit on Home and the director uses it for the whole video.</p>
      {error && <div className="notice error">{error}</div>}

      {loaded && kits.length === 0 && !editing && <div className="muted">No brand kits yet. Create one, or capture a website in a project’s Sources and make a kit from it.</div>}

      <div className="kit-grid">
        {kits.map((k) => (
          <button key={k.id} className={`kit-card ${editing?.draft.id === k.id ? "on" : ""}`} onClick={() => open(toEditing(k))}>
            <KitLogo kit={k} />
            <span className="rc-text">
              <strong>{k.name}</strong>
              <small>{k.fonts.heading} · {k.fonts.body}</small>
              <span className="swatches" aria-label="Colours">
                {(["primary", "accent", "background", "text"] as const).map((c) => <i key={c} style={{ background: k.colors[c] }} title={`${c} ${k.colors[c]}`} />)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {editing && (
        <KitEditor
          key={session}
          editing={editing}
          onEditing={setEditing}
          kits={kits}
          refresh={async () => {
            await refresh();
            onChanged();
          }}
        />
      )}
    </main>
  );
}
