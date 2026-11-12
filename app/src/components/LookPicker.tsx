import { useEffect, useState } from "react";
import { api } from "../api";
import type { Picks, ShelfInfo } from "../types";
import { Icon } from "./Icons";

/**
 * A "Look" pill that opens one select per shelf (visual style, hook, ...). A shelf left on "Director chooses"
 * is not in `picks`. Renders nothing until the catalog arrives, and nothing at all if every shelf is empty.
 * The panel takes a full row of the flex-wrap container it sits in.
 */
export function LookPicker({ picks, onChange, disabled }: { picks: Picks; onChange: (next: Picks) => void; disabled?: boolean }) {
  const [shelves, setShelves] = useState<ShelfInfo[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void api.catalog().then((all) => setShelves(all.filter((s) => s.items.length > 0)), () => setShelves([]));
  }, []);

  if (shelves.length === 0) return null;
  // Only count picks that still exist on a shelf: an item deleted since is not applied by the director either.
  const count = shelves.filter((s) => s.items.some((i) => i.id === picks[s.shelf])).length;

  function pick(shelf: string, id: string) {
    const next = { ...picks };
    if (id === "") delete next[shelf];
    else next[shelf] = id;
    onChange(next);
  }

  return (
    <>
      <button type="button" className={`pill ${count > 0 ? "pill-active" : ""}`} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open} title="Pick the look: visual style, hook, story structure and more">
        <Icon name="sliders" size={15} /> Look{count > 0 ? ` · ${count}` : ""}
      </button>
      {open && (
        <div className="look-pop">
          {shelves.map((s) => (
            <label key={s.shelf} className="look-row">
              <span>{s.label}</span>
              <select value={s.items.some((i) => i.id === picks[s.shelf]) ? picks[s.shelf] : ""} onChange={(e) => pick(s.shelf, e.target.value)} disabled={disabled} title={s.items.find((i) => i.id === picks[s.shelf])?.description}>
                <option value="">Director chooses</option>
                {s.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
          ))}
          <small className="muted">The director follows what you pick and chooses the rest.</small>
        </div>
      )}
    </>
  );
}
