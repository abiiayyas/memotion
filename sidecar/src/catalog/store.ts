import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../config.js";
import { parseFormat } from "../formats/store.js";
import { BUILT_IN } from "./builtin.js";
import { isShelf, SHELF_LABEL, SHELVES, type Picks, type Shelf } from "./shelves.js";

export interface CatalogItem {
  shelf: Shelf;
  id: string;
  name: string;
  description: string;
  /** Markdown the director follows. */
  body: string;
  builtIn: boolean;
}

/** What the picker needs: no body. */
export interface ShelfInfo {
  shelf: Shelf;
  label: string;
  items: Omit<CatalogItem, "body" | "shelf">[];
}

/** One item's text in the brief is capped, so a huge user file cannot crowd out the rules. */
const ITEM_MAX = 2000;

export function shelfDir(shelf: Shelf): string {
  return join(dataDir(), "catalog", shelf);
}

/** Built-ins first, then the user's own `<data dir>/catalog/<shelf>/<id>.md` (same front matter as a format). A user file cannot replace a built-in. */
export async function listShelf(shelf: Shelf): Promise<CatalogItem[]> {
  const builtIn: CatalogItem[] = (BUILT_IN[shelf] ?? []).map((i) => ({ ...i, shelf, builtIn: true }));
  let files: string[] = [];
  try {
    files = await readdir(shelfDir(shelf));
  } catch {
    // No folder yet: nothing of the user's on this shelf.
  }
  const custom: CatalogItem[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;
    const id = file.slice(0, -3).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (builtIn.some((b) => b.id === id) || custom.some((c) => c.id === id)) continue;
    const parsed = parseFormat(id, await readFile(join(shelfDir(shelf), file), "utf8"));
    if (parsed) custom.push({ shelf, id, name: parsed.name, description: parsed.description, body: parsed.body, builtIn: false });
  }
  return [...builtIn, ...custom];
}

export async function getItem(shelf: Shelf, id: string): Promise<CatalogItem | null> {
  return (await listShelf(shelf)).find((i) => i.id === id) ?? null;
}

export async function listCatalog(): Promise<ShelfInfo[]> {
  const out: ShelfInfo[] = [];
  for (const shelf of SHELVES) {
    const items = await listShelf(shelf);
    out.push({ shelf, label: SHELF_LABEL[shelf], items: items.map(({ id, name, description, builtIn }) => ({ id, name, description, builtIn })) });
  }
  return out;
}

/**
 * The picks as one section of the director's brief. An item that was deleted since is simply not applied,
 * like a format or a brand kit. `undefined` when nothing is left to say.
 */
export async function picksBrief(picks: Picks | undefined): Promise<string | undefined> {
  if (!picks) return undefined;
  const parts: string[] = [];
  for (const shelf of SHELVES) {
    const id = picks[shelf];
    const item = id ? await getItem(shelf, id) : null;
    if (item) parts.push(`## ${SHELF_LABEL[shelf]}: ${item.name}\n${item.body.slice(0, ITEM_MAX)}`);
  }
  if (parts.length === 0) return undefined;
  return `# Creative picks\nThe user chose these for the look and feel. Follow each unless they say otherwise in chat; anything not listed here is yours to choose.\n\n${parts.join("\n\n")}`;
}

/** The picks as typed `Picks`, or why they cannot be saved: every shelf and every item must exist. */
export async function parsePicks(input: Record<string, string>): Promise<{ ok: true; picks: Picks } | { ok: false; reason: string }> {
  const picks: Picks = {};
  for (const [shelf, id] of Object.entries(input)) {
    if (!isShelf(shelf)) return { ok: false, reason: `Unknown shelf: ${shelf}` };
    if (!(await getItem(shelf, id))) return { ok: false, reason: `Unknown ${SHELF_LABEL[shelf]}: ${id}` };
    picks[shelf] = id;
  }
  return { ok: true, picks };
}
