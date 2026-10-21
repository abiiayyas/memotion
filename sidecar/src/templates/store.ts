import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { dataDir, projectsDir } from "../config.js";
import { copyProjectTree } from "../projects/copy.js";
import { snapshotProject } from "../engine/tools.js";
import { projectPath, readMeta, writeMeta, type Orientation, type ProjectMeta } from "../projects/store.js";
import { parseVariables, setVariable, type FileVariables } from "../projects/variables.js";

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  /** Whether a preview image was captured when the template was saved. */
  hasThumb: boolean;
}

const TemplateFile = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  orientation: z.enum(["landscape", "portrait"]),
  fps: z.union([z.literal(30), z.literal(60)]),
  createdAt: z.string(),
});

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function templatesDir(): string {
  return join(dataDir(), "templates");
}

function templateDir(id: string): string {
  if (!ID.test(id)) throw new Error("Invalid template id");
  return join(templatesDir(), id);
}

function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "template";
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  await mkdir(templatesDir(), { recursive: true });
  const out: TemplateInfo[] = [];
  for (const e of await readdir(templatesDir(), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try {
      const t = TemplateFile.parse(JSON.parse(await readFile(join(templatesDir(), e.name, "template.json"), "utf8")));
      out.push({ ...t, hasThumb: existsSync(join(templatesDir(), e.name, "thumb.png")) });
    } catch {
      // not a template folder
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function thumbPath(id: string): string {
  return join(templateDir(id), "thumb.png");
}

export async function deleteTemplate(id: string): Promise<void> {
  await rm(templateDir(id), { recursive: true, force: true });
}

/**
 * Snapshot a project as a template. Generated media that belongs to one particular video (the voiceover and
 * the captions built from it) is left out: a template is the design, not the narration.
 */
export async function saveAsTemplate(projectId: string, name: string, description: string): Promise<TemplateInfo> {
  const meta = await readMeta(projectId);
  const id = `${slug(name)}-${randomBytes(3).toString("hex")}`;
  const dir = templateDir(id);
  await mkdir(dir, { recursive: true });
  try {
    await copyProjectTree(projectPath(projectId), join(dir, "project"));
    await rm(join(dir, "project", "assets", "audio", "voiceover.mp3"), { force: true });
    await rm(join(dir, "project", "assets", "transcript.json"), { force: true });

    // A preview image is nice to have; failing to take one must not fail the save.
    try {
      const [still] = await snapshotProject(projectId, [1]);
      if (still) await writeFile(join(dir, "thumb.png"), still.bytes);
    } catch {
      // no thumbnail
    }

    const info = { id, name: name.trim(), description: description.trim(), orientation: meta.orientation, fps: meta.fps, createdAt: new Date().toISOString() };
    await writeFile(join(dir, "template.json"), JSON.stringify(info, null, 2));
    return { ...info, hasThumb: existsSync(join(dir, "thumb.png")) };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

export async function templateVariables(id: string): Promise<FileVariables[]> {
  // Variables live in the template's own files; read them in place (same layout as a project).
  const out: FileVariables[] = [];
  const root = join(templateDir(id), "project");
  const candidates = ["index.html"];
  if (existsSync(join(root, "compositions"))) {
    for (const f of await readdir(join(root, "compositions"))) if (f.endsWith(".html")) candidates.push(`compositions/${f}`);
  }
  for (const file of candidates) {
    if (!existsSync(join(root, file))) continue;
    const variables = parseVariables(await readFile(join(root, file), "utf8"));
    if (variables && variables.length > 0) out.push({ file, variables });
  }
  return out;
}

export interface VariableFill {
  file: string;
  id: string;
  value: unknown;
}

/** A new, independent project from a template. Variable fills are applied to the copy, never to the template. */
export async function createFromTemplate(templateId: string, name: string, fills: VariableFill[] = []): Promise<ProjectMeta> {
  const t = TemplateFile.parse(JSON.parse(await readFile(join(templateDir(templateId), "template.json"), "utf8")));
  const id = `${slug(name)}-${randomBytes(3).toString("hex")}`;
  const dest = join(projectsDir(), id);
  try {
    await copyProjectTree(join(templateDir(templateId), "project"), dest);
    const now = new Date().toISOString();
    const meta: ProjectMeta = { id, name: name.trim() || t.name, orientation: t.orientation, fps: t.fps, createdAt: now, updatedAt: now };
    await writeMeta(id, meta);
    for (const f of fills) await setVariable(id, f.file, f.id, f.value);
    return meta;
  } catch (err) {
    await rm(dest, { recursive: true, force: true });
    throw err;
  }
}
