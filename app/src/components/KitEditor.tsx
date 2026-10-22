import { useEffect, useState } from "react";
import { api, brandLogoUrl } from "../api";
import type { BrandKit, CaptionStyleName } from "../types";
import { PathField } from "./PathField";

const BUNDLED = ["Inter", "Montserrat", "Outfit", "Nunito", "Oswald", "League Gothic", "Archivo Black", "Space Mono", "IBM Plex Mono", "JetBrains Mono", "EB Garamond", "Playfair Display", "Source Code Pro", "Noto Sans JP", "Roboto", "Open Sans", "Lato", "Poppins"];
const COLOR_KEYS = ["primary", "accent", "background", "text"] as const;

export type Editable = Omit<BrandKit, "logo" | "customFonts">;

export interface Editing {
  draft: Editable;
  isNew: boolean;
}

export const BLANK: Editable = {
  id: "",
  name: "",
  colors: { primary: "#3b82f6", accent: "#ff7a3d", background: "#0f1115", text: "#f5f5f5" },
  fonts: { heading: "Poppins", body: "Inter" },
  notes: "",
  captionStyle: "highlight",
};

export const toEditing = (k: BrandKit): Editing => ({ draft: { id: k.id, name: k.name, colors: k.colors, fonts: k.fonts, notes: k.notes, captionStyle: k.captionStyle }, isNew: false });

function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "kit";
}

/**
 * The form for one brand kit: colours, fonts, tone, logo and custom fonts. `onSaved` and `onRemoved` let a caller
 * that holds copies of the kit (a project) bring them up to date.
 */
export function KitEditor({
  editing,
  onEditing,
  kits,
  refresh,
  onSaved,
  onRemoved,
}: {
  editing: Editing;
  onEditing: (e: Editing | null) => void;
  kits: BrandKit[];
  refresh: () => Promise<void>;
  onSaved?: (kitId: string) => Promise<void>;
  onRemoved?: (kitId: string) => Promise<void>;
}) {
  const [logoPath, setLogoPath] = useState("");
  const [fontPath, setFontPath] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState(false);

  const current = kits.find((k) => k.id === editing.draft.id) ?? null;
  useEffect(() => {
    setLogoSrc(null);
    if (current?.logo) void brandLogoUrl(current.id, current.logo + current.customFonts.length).then(setLogoSrc);
  }, [current?.id, current?.logo, current?.customFonts.length]);

  async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      return await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const { draft, isNew } = editing;
    const id = isNew ? `${slug(draft.name)}-${Math.random().toString(16).slice(2, 6)}` : draft.id;
    await run(async () => {
      const saved = await api.saveBrandKit({ ...draft, id });
      await refresh();
      onEditing({ draft: { ...draft, id: saved.id }, isNew: false });
      await onSaved?.(saved.id);
      setNotice("Saved.");
    });
  }

  async function remove() {
    if (editing.isNew) return;
    // window.confirm is not reliable in the desktop webview: ask twice instead.
    if (!armedDelete) {
      setArmedDelete(true);
      setTimeout(() => setArmedDelete(false), 3500);
      return;
    }
    setArmedDelete(false);
    await run(async () => {
      await onRemoved?.(editing.draft.id);
      await api.deleteBrandKit(editing.draft.id);
      onEditing(null);
      await refresh();
    });
  }

  async function attach(kind: "logo" | "font") {
    if (!current) return;
    await run(async () => {
      if (kind === "logo") await api.setBrandLogo(current.id, logoPath.trim());
      else await api.addBrandFont(current.id, fontPath.trim(), fontFamily.trim());
      setLogoPath("");
      setFontPath("");
      setFontFamily("");
      await refresh();
      await onSaved?.(current.id);
    });
  }

  const set = (patch: Partial<Editable>) => onEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  return (
    <form className="kit-editor" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice okmsg">{notice}</div>}
      <label>
        Kit name
        <input value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={60} />
      </label>
      <div className="row">
        {COLOR_KEYS.map((k) => (
          <label key={k} style={{ flex: "none" }}>
            {k}
            <div className="row" style={{ alignItems: "center", flexWrap: "nowrap", gap: 6 }}>
              <input type="color" value={editing.draft.colors[k]} onChange={(e) => set({ colors: { ...editing.draft.colors, [k]: e.target.value } })} style={{ width: 38, height: 28, padding: 0 }} />
              <code>{editing.draft.colors[k]}</code>
            </div>
          </label>
        ))}
      </div>
      <div className="row">
        <label>
          Heading font
          <input list="bundled-fonts" value={editing.draft.fonts.heading} onChange={(e) => set({ fonts: { ...editing.draft.fonts, heading: e.target.value } })} />
        </label>
        <label>
          Body font
          <input list="bundled-fonts" value={editing.draft.fonts.body} onChange={(e) => set({ fonts: { ...editing.draft.fonts, body: e.target.value } })} />
        </label>
        <label>
          Caption style
          <select value={editing.draft.captionStyle} onChange={(e) => set({ captionStyle: e.target.value as CaptionStyleName })}>
            <option value="highlight">Highlight</option>
            <option value="pop">Pop</option>
            <option value="classic">Classic</option>
            <option value="clean">Clean</option>
          </select>
        </label>
      </div>
      <datalist id="bundled-fonts">{BUNDLED.map((f) => <option key={f} value={f} />)}</datalist>
      <label>
        Voice and tone for on-screen text
        <textarea rows={2} value={editing.draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} placeholder="Friendly, short sentences. Always address the viewer as “kamu”." />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>{editing.isNew ? "Create kit" : "Save kit"}</button>
        {!editing.isNew && <button type="button" className="danger" onClick={() => void remove()} disabled={busy}>{armedDelete ? "Click again to delete" : "Delete"}</button>}
        <button type="button" onClick={() => onEditing(null)} disabled={busy}>Close</button>
      </div>

      {current ? (
        <div className="kit-assets">
          <div className="asset-row">
            {logoSrc ? <img src={logoSrc} alt="Logo" className="logo-thumb" /> : <span className="muted">No logo yet</span>}
            <PathField label="Logo image" value={logoPath} onChange={setLogoPath} placeholder="/path/to/logo.png" extensions={["png", "jpg", "jpeg", "svg", "webp"]} disabled={busy} />
            <button type="button" onClick={() => void attach("logo")} disabled={busy || !logoPath.trim()}>Set logo</button>
          </div>
          <div className="asset-row">
            <span className="muted">Custom fonts</span>
            <PathField label="Font file" value={fontPath} onChange={setFontPath} placeholder="/path/to/Font.woff2" extensions={["ttf", "otf", "woff", "woff2"]} disabled={busy} />
            <input value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="Family name" style={{ maxWidth: 150 }} aria-label="Font family name" />
            <button type="button" onClick={() => void attach("font")} disabled={busy || !fontPath.trim() || !fontFamily.trim()}>Add font</button>
          </div>
          {current.customFonts.map((f) => (
            <div key={f.family} className="muted">
              {f.family} <code>{f.file}</code>{" "}
              <button type="button" className="link" onClick={() => void run(async () => { await api.removeBrandFont(current.id, f.family); await refresh(); })}>remove</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">Create the kit first, then add a logo and fonts.</div>
      )}
    </form>
  );
}
