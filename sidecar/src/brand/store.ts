import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { dataDir } from "../config.js";
import { mediaKind, projectPath, updateMeta } from "../projects/store.js";

const Hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Use a hex colour like #ff7a3d");
/** A font family name. It ends up inside CSS the director writes, so only plain names are allowed. */
const FontName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "Use a plain font name");

export const BrandKitInput = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().trim().min(1).max(60),
  colors: z.object({ primary: Hex, accent: Hex, background: Hex, text: Hex }),
  fonts: z.object({ heading: FontName, body: FontName }),
  /** Voice and tone for on-screen copy, in the user's own words. */
  notes: z.string().max(1000).default(""),
  captionStyle: z.enum(["highlight", "pop", "classic", "clean"]).default("highlight"),
});
export type BrandKitInput = z.infer<typeof BrandKitInput>;

export interface CustomFont {
  family: string;
  /** File name inside the kit's `fonts/` folder. */
  file: string;
}

export interface BrandKit extends BrandKitInput {
  /** File name inside the kit folder, when a logo was added. */
  logo?: string;
  customFonts: CustomFont[];
}

const KitFile = BrandKitInput.extend({
  logo: z.string().optional(),
  customFonts: z.array(z.object({ family: FontName, file: z.string() })).default([]),
});

const MAX_ASSET_BYTES = 25_000_000;
const FONT_EXT: Record<string, true> = { ".ttf": true, ".otf": true, ".woff": true, ".woff2": true };

function kitsDir(): string {
  return join(dataDir(), "brand-kits");
}

function kitDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error("Invalid brand kit id");
  return join(kitsDir(), id);
}

export async function listBrandKits(): Promise<BrandKit[]> {
  await mkdir(kitsDir(), { recursive: true });
  const out: BrandKit[] = [];
  for (const e of await readdir(kitsDir(), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const kit = await getBrandKit(e.name);
    if (kit) out.push(kit);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBrandKit(id: string): Promise<BrandKit | null> {
  try {
    return KitFile.parse(JSON.parse(await readFile(join(kitDir(id), "kit.json"), "utf8")));
  } catch {
    return null;
  }
}

async function save(kit: BrandKit): Promise<void> {
  const dir = kitDir(kit.id);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "kit.json");
  await writeFile(`${file}.part`, JSON.stringify(kit, null, 2));
  await rename(`${file}.part`, file);
}

/** Create or update the editable fields. Logo and custom fonts are kept as they were. */
export async function upsertBrandKit(input: unknown): Promise<BrandKit> {
  const fields = BrandKitInput.parse(input);
  const existing = await getBrandKit(fields.id);
  const kit: BrandKit = { ...fields, logo: existing?.logo, customFonts: existing?.customFonts ?? [] };
  await save(kit);
  return kit;
}

export async function removeBrandKit(id: string): Promise<void> {
  await rm(kitDir(id), { recursive: true, force: true });
}

async function copyAsset(sourcePath: string, destDir: string, destName: string): Promise<void> {
  const info = await stat(sourcePath);
  if (!info.isFile()) throw new Error("Not a file");
  if (info.size > MAX_ASSET_BYTES) throw new Error(`File is larger than ${MAX_ASSET_BYTES / 1_000_000} MB.`);
  await mkdir(destDir, { recursive: true });
  const tmp = join(destDir, `.${destName}.part`);
  await copyFile(sourcePath, tmp);
  await rename(tmp, join(destDir, destName));
}

export async function setLogo(id: string, sourcePath: string): Promise<BrandKit> {
  const kit = await getBrandKit(id);
  if (!kit) throw new Error("Unknown brand kit");
  if (mediaKind(sourcePath) !== "image") throw new Error("The logo must be an image (png, jpg, svg, webp…).");
  const name = `logo${extname(sourcePath).toLowerCase()}`;
  if (kit.logo && kit.logo !== name) await rm(join(kitDir(id), kit.logo), { force: true });
  await copyAsset(sourcePath, kitDir(id), name);
  const next = { ...kit, logo: name };
  await save(next);
  return next;
}

export async function addFont(id: string, sourcePath: string, family: string): Promise<BrandKit> {
  const kit = await getBrandKit(id);
  if (!kit) throw new Error("Unknown brand kit");
  const ext = extname(sourcePath).toLowerCase();
  if (!FONT_EXT[ext]) throw new Error("Fonts must be .ttf, .otf, .woff or .woff2.");
  const name = FontName.parse(family);
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${ext}`;
  await copyAsset(sourcePath, join(kitDir(id), "fonts"), file);
  const next = { ...kit, customFonts: [...kit.customFonts.filter((f) => f.family !== name), { family: name, file }] };
  await save(next);
  return next;
}

export async function removeFont(id: string, family: string): Promise<BrandKit> {
  const kit = await getBrandKit(id);
  if (!kit) throw new Error("Unknown brand kit");
  const gone = kit.customFonts.find((f) => f.family === family);
  if (gone) await rm(join(kitDir(id), "fonts", gone.file), { force: true });
  const next = { ...kit, customFonts: kit.customFonts.filter((f) => f.family !== family) };
  await save(next);
  return next;
}

/** Absolute path to the logo, for serving it to the UI. */
export function logoPath(kit: BrandKit): string | null {
  if (!kit.logo) return null;
  const file = join(kitDir(kit.id), kit.logo);
  return existsSync(file) ? file : null;
}

export interface AppliedBrand {
  kit: BrandKit;
  /** Project-relative paths that now exist, for the director's brief. */
  logoPath?: string;
  fontFiles: { family: string; path: string }[];
}

/**
 * Make a kit the project's brand: copy the logo and custom fonts into the project (the composition may only
 * reference files inside it) and remember the choice. Files from an earlier kit are removed first.
 */
export async function applyBrandKit(projectId: string, kitId: string): Promise<AppliedBrand> {
  const kit = await getBrandKit(kitId);
  if (!kit) throw new Error("Unknown brand kit");
  const root = projectPath(projectId);
  await rm(join(root, "assets", "brand"), { recursive: true, force: true });
  await mkdir(join(root, "assets", "brand"), { recursive: true });

  const applied: AppliedBrand = { kit, fontFiles: [] };
  if (kit.logo) {
    await copyAsset(join(kitDir(kitId), kit.logo), join(root, "assets", "brand"), kit.logo);
    applied.logoPath = `assets/brand/${kit.logo}`;
  }
  for (const f of kit.customFonts) {
    await copyAsset(join(kitDir(kitId), "fonts", f.file), join(root, "assets", "fonts"), basename(f.file));
    applied.fontFiles.push({ family: f.family, path: `assets/fonts/${f.file}` });
  }
  await updateMeta(projectId, { brandKitId: kitId });
  return applied;
}

/** Fonts the renderer resolves by name (from the HyperFrames format reference). */
export const BUNDLED_FONTS = [
  "Inter", "Montserrat", "Outfit", "Nunito", "Oswald", "League Gothic", "Archivo Black", "Space Mono", "IBM Plex Mono",
  "JetBrains Mono", "EB Garamond", "Playfair Display", "Source Code Pro", "Noto Sans JP", "Roboto", "Open Sans", "Lato", "Poppins",
];

/** What the director is told about the brand. Kept short: every line costs context on every request. */
export function brandBrief(kit: BrandKit, applied: Pick<AppliedBrand, "logoPath" | "fontFiles">): string {
  const c = kit.colors;
  const lines = [
    `Brand "${kit.name}". Use it for every visual decision; do not invent a different palette.`,
    `- Colours: primary ${c.primary}, accent ${c.accent}, background ${c.background}, text ${c.text}. Expose them as variables (primary, accent, background, text).`,
    `- Fonts: headings "${kit.fonts.heading}", body "${kit.fonts.body}".`,
  ];
  for (const f of applied.fontFiles) {
    lines.push(`  "${f.family}" is a custom font: declare @font-face { font-family: "${f.family}"; src: url("${f.path}"); } in the file that uses it.`);
  }
  // A font that is not bundled and has no file cannot render by name; say so instead of letting it silently fall back.
  for (const role of ["heading", "body"] as const) {
    const family = kit.fonts[role];
    if (!BUNDLED_FONTS.includes(family) && !applied.fontFiles.some((f) => f.family === family)) {
      lines.push(`  "${family}" (${role}) is not available as a file: use the closest bundled font (${BUNDLED_FONTS.slice(0, 6).join(", ")}…) and mention the substitution in your summary.`);
    }
  }
  if (applied.logoPath) lines.push(`- Logo: ${applied.logoPath}. Show it in the opening or closing scene; never stretch or recolour it.`);
  if (kit.notes.trim()) lines.push(`- Voice and tone: ${kit.notes.trim()}`);
  lines.push(`- Caption style: ${kit.captionStyle} (pass it to generate_voiceover as captionStyle, with these colours).`);
  return lines.join("\n");
}
