import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { projectsDir } from "../config.js";
import { runCli } from "../engine/cli.js";
import type { Picks } from "../catalog/shelves.js";

export type Orientation = "landscape" | "portrait";

export interface ProjectMeta {
  id: string;
  name: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  updatedAt: string;
  /** Brand kit applied to this project; its colours, fonts and logo go into the director's brief. */
  brandKitId?: string;
  /** Workflow format (a markdown recipe) the director follows for this project. */
  formatId?: string;
  /** Installed skill (see skills/store.ts) the director reads before designing. */
  skillId?: string;
  /** The look and feel chosen per shelf (see catalog/store.ts); the director chooses where a shelf is empty. */
  picks?: Picks;
}

export const DIMENSIONS: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

const META_FILE = "memotion.json";

export function projectPath(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error("Invalid project id");
  return join(projectsDir(), id);
}

/**
 * Resolve a user/agent-supplied relative path inside a project, refusing anything that escapes it
 * (`..`, absolute paths, symlink-free by construction: we only compare resolved strings).
 */
export function safeJoin(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Path escapes project: ${rel}`);
  return abs;
}

export async function readMeta(id: string): Promise<ProjectMeta> {
  return JSON.parse(await readFile(join(projectPath(id), META_FILE), "utf8")) as ProjectMeta;
}

export async function touch(id: string): Promise<void> {
  const meta = await readMeta(id);
  meta.updatedAt = new Date().toISOString();
  await writeFile(join(projectPath(id), META_FILE), JSON.stringify(meta, null, 2));
}

export async function writeMeta(id: string, meta: ProjectMeta): Promise<void> {
  await writeFile(join(projectPath(id), META_FILE), JSON.stringify(meta, null, 2));
}

/** Change optional project settings. `undefined` removes a field. */
export async function updateMeta(id: string, patch: Partial<Pick<ProjectMeta, "brandKitId" | "formatId" | "skillId" | "picks" | "name">>): Promise<ProjectMeta> {
  const meta = { ...(await readMeta(id)), ...patch, updatedAt: new Date().toISOString() };
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) if (patch[key] === undefined) delete meta[key];
  await writeMeta(id, meta);
  return meta;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const out: ProjectMeta[] = [];
  for (const entry of await readdir(projectsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      out.push(await readMeta(entry.name));
    } catch {
      // Not one of ours (no memotion.json): skip rather than fail the whole list.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "video";
}

export async function createProject(input: {
  name: string;
  orientation: Orientation;
  fps?: 30 | 60;
}): Promise<ProjectMeta> {
  const id = `${slugify(input.name)}-${randomBytes(3).toString("hex")}`;
  const result = await runCli(
    ["init", id, "--example", "blank", "--non-interactive", "--resolution", input.orientation],
    { cwd: projectsDir(), timeoutMs: 120_000 },
  );
  if (result.code !== 0 || !existsSync(projectPath(id))) {
    throw new Error(`hyperframes init failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id,
    name: input.name,
    orientation: input.orientation,
    fps: input.fps ?? 30,
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(join(projectPath(id), META_FILE), JSON.stringify(meta, null, 2));
  return meta;
}

export async function deleteProject(id: string): Promise<void> {
  await rm(projectPath(id), { recursive: true, force: true });
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const meta = await readMeta(id);
  meta.name = name;
  meta.updatedAt = new Date().toISOString();
  await writeFile(join(projectPath(id), META_FILE), JSON.stringify(meta, null, 2));
  return meta;
}

const IGNORED: Record<string, true> = {
  node_modules: true,
  ".git": true,
  renders: true,
  ".memotion": true,
  ".hyperframes": true,
};

/** Flat list of project files (relative, posix separators), without build/render noise. */
export async function listFiles(id: string): Promise<string[]> {
  const root = projectPath(id);
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (IGNORED[e.name] || e.name.startsWith(".DS_Store")) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(dir, e.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out.sort();
}

export const MEDIA_KINDS = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"],
  video: [".mp4", ".mov", ".webm", ".m4v"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
  font: [".ttf", ".otf", ".woff", ".woff2"],
} as const;

export type MediaKind = keyof typeof MEDIA_KINDS;

export function mediaKind(file: string): MediaKind | null {
  const ext = extname(file).toLowerCase();
  for (const [kind, exts] of Object.entries(MEDIA_KINDS)) {
    if ((exts as readonly string[]).includes(ext)) return kind as MediaKind;
  }
  return null;
}

export interface ImportedMedia {
  /** Root-relative path, as compositions must reference it: `assets/<kind>/<name>`. */
  path: string;
  kind: MediaKind;
  bytes: number;
}

/** Copy a file from anywhere on disk into the project's assets folder, never overwriting. */
export async function importMedia(id: string, sourcePath: string): Promise<ImportedMedia> {
  const kind = mediaKind(sourcePath);
  if (!kind) throw new Error(`Unsupported file type: ${extname(sourcePath) || basename(sourcePath)}`);
  const info = await stat(sourcePath);
  if (!info.isFile()) throw new Error("Not a file");

  const folder = kind === "font" ? "fonts" : kind === "image" ? "images" : kind;
  const dir = join(projectPath(id), "assets", folder);
  await mkdir(dir, { recursive: true });

  const ext = extname(sourcePath).toLowerCase();
  const stem = slugify(basename(sourcePath, extname(sourcePath)));
  let name = `${stem}${ext}`;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${stem}-${n}${ext}`;

  // Atomic: a half-copied file must never be visible to preview or render.
  const tmp = join(dir, `.${name}.part`);
  await copyFile(sourcePath, tmp);
  await rename(tmp, join(dir, name));
  await touch(id);
  return { path: `assets/${folder}/${name}`, kind, bytes: info.size };
}

export async function listMedia(id: string): Promise<ImportedMedia[]> {
  const out: ImportedMedia[] = [];
  for (const rel of await listFiles(id)) {
    if (!rel.startsWith("assets/")) continue;
    const kind = mediaKind(rel);
    if (!kind) continue;
    out.push({ path: rel, kind, bytes: (await stat(join(projectPath(id), rel))).size });
  }
  return out;
}
