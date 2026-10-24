import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { dataDir } from "../config.js";

/**
 * Skills are Agent Skills folders (a `SKILL.md` with `name` and `description`, plus markdown it points to) that the
 * user installs from a GitHub link. Only text documents are kept; scripts, binaries and images are never fetched
 * and nothing in a skill is ever executed. The director reads a skill through the `read_skill` tool.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** What the user pasted: a GitHub link or the path of a folder. */
  source: string;
  origin: "github" | "folder";
  /** `owner/repo/folder`, lower case: the same skill installed again replaces itself. */
  key: string;
  /** Paths relative to the skill folder, `SKILL.md` first. The only files `read_skill` will open. */
  files: string[];
  bytes: number;
  installedAt: string;
}

const Manifest = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.string(),
  origin: z.enum(["github", "folder"]).default("github"),
  key: z.string(),
  files: z.array(z.string()),
  bytes: z.number(),
  installedAt: z.string(),
});

const MANIFEST = ".memotion-skill.json";
const DOC_EXT = /\.(md|markdown|txt)$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const SKILL_LIMITS = { files: 300, fileBytes: 300_000, totalBytes: 4_000_000, skillMdBytes: 200_000 } as const;

const skillsDir = (): string => join(dataDir(), "skills");

// ── SKILL.md ─────────────────────────────────────────────────────────────────────────────

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** The two frontmatter fields Memotion needs. Handles plain, quoted and folded (`>`, `|`) values; ignores the rest. */
export function parseSkillMd(raw: string): ParsedSkill | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const body = (m ? (m[2] ?? "") : raw).trim();
  if (body.length === 0) return null;
  const head: Record<string, string> = {};
  const lines = (m?.[1] ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i] ?? "");
    if (!kv?.[1]) continue;
    const first = (kv[2] ?? "").trim();
    const parts = /^[>|][+-]?$/.test(first) || first === "" ? [] : [first];
    while (/^\s+\S/.test(lines[i + 1] ?? "")) parts.push((lines[++i] ?? "").trim());
    let value = parts.join(" ");
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2] ?? "";
    head[kv[1].toLowerCase()] = value;
  }
  return { name: (head.name ?? "").trim(), description: (head.description ?? "").trim(), body };
}

// ── GitHub links ─────────────────────────────────────────────────────────────────────────

export interface GithubLink {
  owner: string;
  repo: string;
  /** Segments after `/tree/` or `/blob/`: a branch name followed by a folder, not yet told apart. */
  rest: string[];
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Only github.com repository links: `…/owner/repo`, `…/tree/<branch>/<folder>` or `…/blob/<branch>/<folder>/SKILL.md`. */
export function parseGithubUrl(input: string): GithubLink {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new Error("That is not a link. Paste a GitHub address such as https://github.com/owner/repo.");
  }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com")) {
    throw new Error("Only https://github.com links can be installed.");
  }
  const parts = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    throw new Error("The link must name a repository: https://github.com/owner/repo.");
  }
  if (kind !== undefined && kind !== "tree" && kind !== "blob") throw new Error("Paste the repository link, or the link to the skill's folder.");
  if (rest.some((s) => s === ".." || s === "." || s.includes("\\"))) throw new Error("That link has an invalid folder.");
  const tail = kind === "blob" && /^SKILL\.md$/i.test(rest.at(-1) ?? "") ? rest.slice(0, -1) : rest;
  return { owner, repo, rest: tail };
}

const UA = { "User-Agent": "Memotion", "X-GitHub-Api-Version": "2022-11-28" };

async function github(fetcher: typeof fetch, url: string, accept: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, { headers: { ...UA, Accept: accept }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's request limit was reached. Try again in a while.");
  return res;
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

const TreeResponse = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional() })),
});

async function listTree(fetcher: typeof fetch, owner: string, repo: string, ref: string): Promise<TreeEntry[] | null> {
  const res = await github(fetcher, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, "application/vnd.github+json");
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status} while listing ${owner}/${repo}.`);
  const tree = TreeResponse.parse(await res.json());
  if (tree.truncated) throw new Error("That repository is too large to list. Paste the link to the skill's folder instead.");
  return tree.tree;
}

const DefaultBranch = z.object({ default_branch: z.string() });

/** Which part of `rest` is the branch is not knowable from the text (branches may contain `/`), so ask GitHub. */
async function resolveTree(fetcher: typeof fetch, link: GithubLink): Promise<{ ref: string; folder: string; tree: TreeEntry[] }> {
  const { owner, repo, rest } = link;
  if (rest.length === 0) {
    const res = await github(fetcher, `https://api.github.com/repos/${owner}/${repo}`, "application/vnd.github+json");
    if (res.status === 404) throw new Error(`${owner}/${repo} was not found. Private repositories cannot be installed.`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${owner}/${repo}.`);
    const ref = DefaultBranch.parse(await res.json()).default_branch;
    const tree = await listTree(fetcher, owner, repo, ref);
    if (!tree) throw new Error(`${owner}/${repo} has no files on its default branch.`);
    return { ref, folder: "", tree };
  }
  for (let k = 1; k <= Math.min(rest.length, 4); k++) {
    const ref = rest.slice(0, k).join("/");
    const tree = await listTree(fetcher, owner, repo, ref);
    if (tree) return { ref, folder: rest.slice(k).join("/"), tree };
  }
  throw new Error(`The branch or folder in that link was not found in ${owner}/${repo}.`);
}

function safeRelative(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

async function mapLimit<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await job(items[at] as T);
      }
    }),
  );
  return out;
}

// ── install, list, remove ────────────────────────────────────────────────────────────────

const slug = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function readManifest(dir: string): Promise<Skill | null> {
  try {
    return Manifest.parse(JSON.parse(await readFile(join(dir, MANIFEST), "utf8")));
  } catch {
    return null;
  }
}

export async function listSkills(): Promise<Skill[]> {
  if (!existsSync(skillsDir())) return [];
  const out: Skill[] = [];
  for (const e of await readdir(skillsDir(), { withFileTypes: true })) {
    if (!e.isDirectory() || !ID.test(e.name)) continue;
    const skill = await readManifest(join(skillsDir(), e.name));
    if (skill && skill.id === e.name) out.push(skill);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(id: string): Promise<Skill | null> {
  return ID.test(id) ? readManifest(join(skillsDir(), id)) : null;
}

export async function removeSkill(id: string): Promise<boolean> {
  if (!ID.test(id) || !existsSync(join(skillsDir(), id))) return false;
  await rm(join(skillsDir(), id), { recursive: true, force: true });
  return true;
}

/** SKILL.md first, then shallow files before deep ones; whatever does not fit the limits is left out. */
function selectDocs<T extends { path: string; size: number }>(found: T[]): T[] {
  const sorted = [...found].sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path)));
  const skillMd = sorted.find((e) => e.path === "SKILL.md");
  if (!skillMd) throw new Error("No SKILL.md was found there.");
  if (skillMd.size > SKILL_LIMITS.skillMdBytes) throw new Error("This SKILL.md is too large to use.");
  const keep: T[] = [];
  let total = 0;
  for (const f of sorted) {
    if (f.size > SKILL_LIMITS.fileBytes || keep.length >= SKILL_LIMITS.files || total + f.size > SKILL_LIMITS.totalBytes) continue;
    keep.push(f);
    total += f.size;
  }
  return keep;
}

/**
 * Download the text documents of one skill from GitHub and keep them under `<data dir>/skills/<id>/`.
 * A link to a repository works when the repository holds exactly one skill; otherwise the link must point at one folder.
 */
export async function installSkill(link: string, fetcher: typeof fetch = fetch): Promise<Skill> {
  const parsed = parseGithubUrl(link);
  const { owner, repo } = parsed;
  const { ref, folder, tree } = await resolveTree(fetcher, parsed);

  // `dir` is the folder itself or somewhere below it; the repository root ("") holds everything.
  const inside = (path: string, dir: string): boolean => dir === "" || path === dir || path.startsWith(`${dir}/`);
  const roots = tree
    .filter((e) => e.type === "blob" && (e.path === "SKILL.md" || e.path.endsWith("/SKILL.md")))
    .map((e) => (dirname(e.path) === "." ? "" : dirname(e.path)))
    .filter((dir) => inside(dir, folder));
  if (roots.length === 0) throw new Error("No SKILL.md was found there. A skill is a folder with a SKILL.md file in it.");
  const root = roots.includes(folder) ? folder : roots.length === 1 ? (roots[0] as string) : null;
  if (root === null) {
    const shown = roots.slice(0, 8).map((r) => `https://github.com/${owner}/${repo}/tree/${ref}/${r}`).join("\n");
    throw new Error(`That link holds ${roots.length} skills. Paste the link to one folder, for example:\n${shown}${roots.length > 8 ? "\n…" : ""}`);
  }

  const wanted = tree
    .filter((e) => e.type === "blob" && inside(e.path, root) && e.path !== root && DOC_EXT.test(e.path))
    .map((e) => ({ path: root === "" ? e.path : e.path.slice(root.length + 1), full: e.path, size: e.size ?? 0 }))
    .filter((e) => safeRelative(e.path) && !e.path.split("/").includes(".git"));
  const keep = selectDocs(wanted);

  const docs = await mapLimit(keep, 6, async (f) => {
    const encode = (p: string): string => p.split("/").map(encodeURIComponent).join("/");
    const res = await github(fetcher, `https://raw.githubusercontent.com/${owner}/${repo}/${encode(ref)}/${encode(f.full)}`, "text/plain");
    if (!res.ok) throw new Error(`Could not download ${f.full} (GitHub answered ${res.status}).`);
    const text = await res.text();
    if (Buffer.byteLength(text) > SKILL_LIMITS.fileBytes) throw new Error(`${f.full} is larger than expected.`);
    return { path: f.path, text };
  });

  const pasted = link.trim();
  const source = /^https?:\/\//i.test(pasted) ? pasted : `https://${pasted}`;
  return commitSkill(docs, { source, key: `${owner}/${repo}/${root}`.toLowerCase(), origin: "github", fallbackName: basename(root) || repo });
}

/** Keep a skill's documents under `<data dir>/skills/<id>/`. The same `key` installed again replaces the earlier copy. */
async function commitSkill(docs: { path: string; text: string }[], from: { source: string; key: string; origin: Skill["origin"]; fallbackName: string }): Promise<Skill> {
  const entry = docs.find((d) => d.path === "SKILL.md");
  const parsedMd = entry ? parseSkillMd(entry.text) : null;
  if (!parsedMd) throw new Error("SKILL.md is empty.");
  const name = parsedMd.name || from.fallbackName;

  await mkdir(skillsDir(), { recursive: true });
  const existing = await listSkills();
  const same = existing.find((s) => s.key === from.key);
  const base = slug(name) || "skill";
  let id = same?.id ?? base;
  for (let n = 2; !same && existing.some((s) => s.id === id); n++) id = `${base}-${n}`;

  const staging = join(skillsDir(), `.tmp-${randomBytes(4).toString("hex")}`);
  try {
    for (const d of docs) {
      await mkdir(dirname(join(staging, d.path)), { recursive: true });
      await writeFile(join(staging, d.path), d.text);
    }
    const skill: Skill = {
      id,
      name,
      description: parsedMd.description,
      source: from.source,
      origin: from.origin,
      key: from.key,
      files: docs.map((d) => d.path),
      bytes: docs.reduce((n, d) => n + Buffer.byteLength(d.text), 0),
      installedAt: new Date().toISOString(),
    };
    await writeFile(join(staging, MANIFEST), JSON.stringify(skill, null, 2));
    await rm(join(skillsDir(), id), { recursive: true, force: true });
    await rename(staging, join(skillsDir(), id));
    return skill;
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

const WALK_DEPTH = 8;
const WALK_ENTRIES = 20_000;

/**
 * Take a skill from a folder on this computer, for example one that `npx impeccable install` put in `~/.claude/skills`.
 * A folder holding exactly one skill below it works too. Same rules as GitHub: text documents only, symlinks and
 * hidden tool folders skipped, nothing run.
 */
export async function installSkillFromFolder(folder: string): Promise<Skill> {
  const given = await realpath(resolve(folder)).catch(() => null);
  if (!given || !(await stat(given)).isDirectory()) throw new Error("Choose a folder that exists.");
  const own = await realpath(skillsDir()).catch(() => resolve(skillsDir()));
  if (given === own || given.startsWith(own + sep)) throw new Error("That folder is already inside Memotion.");

  let root = given;
  if (!existsSync(join(root, "SKILL.md"))) {
    const children: string[] = [];
    for (const e of await readdir(given, { withFileTypes: true })) if (e.isDirectory() && existsSync(join(given, e.name, "SKILL.md"))) children.push(e.name);
    if (children.length === 0) throw new Error("No SKILL.md was found in that folder. A skill is a folder with a SKILL.md file in it.");
    if (children.length > 1) throw new Error(`That folder holds ${children.length} skills (${children.slice(0, 8).join(", ")}${children.length > 8 ? ", …" : ""}). Choose one of them.`);
    root = join(given, children[0] as string);
  }

  const wanted: { path: string; size: number }[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (++visited > WALK_ENTRIES) return;
      if (e.isSymbolicLink() || e.name === ".git" || e.name === "node_modules") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < WALK_DEPTH) await walk(full, depth + 1);
      } else if (e.isFile() && DOC_EXT.test(e.name)) {
        const path = relative(root, full).split(sep).join("/");
        if (safeRelative(path)) wanted.push({ path, size: (await stat(full)).size });
      }
    }
  }
  await walk(root, 0);

  const docs = await Promise.all(selectDocs(wanted).map(async (f) => ({ path: f.path, text: await readFile(join(root, ...f.path.split("/")), "utf8") })));
  return commitSkill(docs, { source: root, key: `folder:${root}`, origin: "folder", fallbackName: basename(root) });
}

// ── reading ──────────────────────────────────────────────────────────────────────────────

export const SKILL_CHUNK = 60_000;

/** One installed document. Only paths the install recorded can be opened, so a path from the model cannot leave the folder. */
export async function readSkillFile(skill: Skill, file = "SKILL.md"): Promise<string | null> {
  if (!skill.files.includes(file)) return null;
  return readFile(join(skillsDir(), skill.id, file), "utf8");
}
