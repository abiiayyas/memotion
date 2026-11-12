/** The shelves a video's look is picked from. Order is the order the director reads them in. */
export const SHELVES = ["visual", "edit", "hook", "framework", "structure", "preset", "effects", "captions"] as const;

export type Shelf = (typeof SHELVES)[number];

export const SHELF_LABEL: Record<Shelf, string> = {
  visual: "Visual style",
  edit: "Edit style",
  hook: "Hook",
  framework: "Viral framework",
  structure: "Story structure",
  preset: "Effects preset",
  effects: "Extra effects",
  captions: "Captions",
};

/** One chosen item per shelf. A shelf without an entry is the director's choice. */
export type Picks = Partial<Record<Shelf, string>>;

export function isShelf(value: string): value is Shelf {
  return (SHELVES as readonly string[]).includes(value);
}
