import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { findRemotionCli, findRemotionEntry, mountRenderedVideo, readMp4Info } from "./remotionRender.js";
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir, projectsDir } from "../config.js";
import { copyProjectTree, type CopyLimits } from "./copy.js";
import { createProject, projectPath, writeMeta, type Orientation, type ProjectMeta } from "./store.js";

const slug = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

/** A project from elsewhere must be a folder that is not already inside Memotion's own data. */
async function assertImportable(source: string): Promise<string> {
  const abs = resolve(source);
  const info = await stat(abs).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Choose a folder, not a file.");
  const own = resolve(dataDir()) + sep;
  if ((abs + sep).startsWith(own)) throw new Error("That folder is already inside Memotion.");
  return abs;
}

// ── HyperFrames ──────────────────────────────────────────────────────────────────────────

export interface CompositionFacts {
  orientation: Orientation;
  fps: 30 | 60;
}

/** Read orientation and frame rate from the root composition's attributes; default to 16:9 at 30 fps. */
export function readCompositionFacts(indexHtml: string): CompositionFacts {
  const root = [...indexHtml.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]).find((t) => /\bdata-composition-id=/.test(t) && !/\bdata-composition-src=/.test(t)) ?? "";
  const num = (attr: string): number | null => {
    const m = new RegExp(`\\b${attr}=["']([0-9.]+)["']`).exec(root);
    return m?.[1] ? Number(m[1]) : null;
  };
  const w = num("data-width");
  const h = num("data-height");
  return { orientation: w !== null && h !== null && h > w ? "portrait" : "landscape", fps: num("data-fps") === 60 ? 60 : 30 };
}

export async function importHyperframesProject(sourceDir: string, name?: string): Promise<ProjectMeta> {
  const src = await assertImportable(sourceDir);
  if (!existsSync(join(src, "index.html"))) throw new Error("This folder has no index.html, so it is not a HyperFrames project.");
  const facts = readCompositionFacts(await readFile(join(src, "index.html"), "utf8"));
  const title = name?.trim() || basename(src);
  const id = `${slug(title)}-${randomBytes(3).toString("hex")}`;
  const dest = join(projectsDir(), id);
  try {
    await copyProjectTree(src, dest);
  } catch (err) {
    await rm(dest, { recursive: true, force: true });
    throw err;
  }
  const now = new Date().toISOString();
  const meta: ProjectMeta = { id, name: title, ...facts, createdAt: now, updatedAt: now };
  await writeMeta(id, meta);
  return meta;
}

// ── Remotion ─────────────────────────────────────────────────────────────────────────────

export interface RemotionFinding {
  severity: "blocker" | "warning" | "info";
  file: string;
  message: string;
}

const RULES: { severity: RemotionFinding["severity"]; test: RegExp; message: string }[] = [
  { severity: "blocker", test: /\buseState\s*[(<]/, message: "useState: interactive state cannot exist in a rendered video." },
  { severity: "blocker", test: /\buseReducer\s*\(/, message: "useReducer: interactive state cannot exist in a rendered video." },
  // useEffect(..., [deps]) is detected by `effectHasDependencies`, not by a regex: the callback holds parentheses of its own.
  { severity: "blocker", test: /\basync\s+function\s+calculateMetadata|calculateMetadata\s*=\s*async/, message: "async calculateMetadata: the length cannot depend on a fetch." },
  { severity: "blocker", test: /from\s+["'](@mui\/|@chakra-ui\/|@mantine\/|antd|@radix-ui\/|@nextui-org\/)/, message: "A third-party React UI library: its components have no HTML/GSAP equivalent." },
  { severity: "warning", test: /@remotion\/lambda/, message: "Lambda config is dropped; rendering happens in this app." },
  { severity: "warning", test: /\bdelayRender\s*\(/, message: "delayRender is dropped; assets must exist when the page loads." },
  { severity: "warning", test: /\buse(Callback|Memo)\s*\(/, message: "useCallback/useMemo are dropped; their bodies are inlined." },
  { severity: "info", test: /\bstaticFile\s*\(/, message: "staticFile paths map to assets/public/ in the converted project." },
  { severity: "info", test: /\binterpolateColors\s*\(/, message: "interpolateColors becomes a GSAP colour tween." },
];

const SOURCE_EXT: Record<string, true> = { ".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true };
const REMOTION_SKIP: Record<string, true> = { out: true, build: true, dist: true, ".next": true, ".cache": true, coverage: true, ".remotion": true };

/**
 * True when some `useEffect(...)` / `useLayoutEffect(...)` call ends with a non-empty dependency array. An empty
 * array runs once on mount, which translates; a populated one ties the effect to changing state, which cannot.
 */
export function effectHasDependencies(text: string): boolean {
  const call = /\buse(?:Layout)?Effect\s*\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    let depth = 1;
    let argStart = call.lastIndex;
    let lastArg = "";
    for (let i = call.lastIndex; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) lastArg = text.slice(argStart, i);
      } else if (ch === "," && depth === 1) argStart = i + 1;
    }
    if (/^\s*\[\s*[^\]\s]/.test(lastArg)) return true;
  }
  return false;
}

/** Scan source text for constructs that cannot be translated. Pure so it can be tested without a project. */
export function lintRemotionSource(files: { path: string; text: string }[]): RemotionFinding[] {
  const found: RemotionFinding[] = [];
  for (const f of files) {
    for (const rule of RULES) if (rule.test.test(f.text)) found.push({ severity: rule.severity, file: f.path, message: rule.message });
    if (effectHasDependencies(f.text)) {
      found.push({ severity: "blocker", file: f.path, message: "useEffect with dependencies: side effects tied to React state do not translate." });
    }
  }
  return found;
}

/** Ids of every `<Composition id="…">`, in source order. */
export function readCompositionIds(files: { text: string }[]): string[] {
  const ids: string[] = [];
  for (const f of files) {
    for (const tag of f.text.matchAll(/<Composition\b[\s\S]*?\/?>/g)) {
      const id = /\bid=\{?\s*["'`]([\w-]+)["'`]/.exec(tag[0])?.[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Orientation and frame rate come from `<Composition … width height fps>`: the one named `compositionId`, else the first. */
export function readRemotionFacts(files: { text: string }[], compositionId?: string): CompositionFacts {
  const tags = files.flatMap((f) => [...f.text.matchAll(/<Composition\b[\s\S]*?\/?>/g)].map((m) => m[0]));
  const tag = (compositionId && tags.find((t) => new RegExp(`\\bid=\\{?\\s*["'\`]${compositionId}["'\`]`).test(t))) || tags[0];
  if (!tag) return { orientation: "landscape", fps: 30 };
  const num = (name: string): number | null => {
    const m = new RegExp(`\\b${name}=\\{?\\s*([0-9.]+)\\s*\\}?`).exec(tag);
    return m?.[1] ? Number(m[1]) : null;
  };
  const w = num("width");
  const h = num("height");
  return { orientation: w !== null && h !== null && h > w ? "portrait" : "landscape", fps: num("fps") === 60 ? 60 : 30 };
}

async function readSources(dir: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || REMOTION_SKIP[e.name] || e.isSymbolicLink()) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (SOURCE_EXT[extname(e.name)] && (await stat(full)).size < 400_000) out.push({ path: relative(dir, full), text: await readFile(full, "utf8") });
    }
  }
  await walk(dir);
  return out;
}

export interface RemotionAnalysis {
  findings: RemotionFinding[];
  blocked: boolean;
  facts: CompositionFacts;
  sourceFiles: number;
  /** Every `<Composition id>` found, in source order. */
  compositions: string[];
  /** Whether the project can be rendered to a video here: needs its own installed dependencies and an entry file. */
  render: { ready: boolean; reason?: string };
}

export async function analyzeRemotionProject(sourceDir: string, compositionId?: string): Promise<RemotionAnalysis> {
  const src = await assertImportable(sourceDir);
  const pkg = existsSync(join(src, "package.json")) ? await readFile(join(src, "package.json"), "utf8") : "";
  if (!/"remotion"|@remotion\//.test(pkg)) throw new Error("This folder is not a Remotion project (no remotion dependency in package.json).");
  const files = await readSources(src);
  const findings = lintRemotionSource(files);
  const compositions = readCompositionIds(files);
  const [cli, entry] = await Promise.all([findRemotionCli(src), findRemotionEntry(src)]);
  const reason = !cli
    ? "Remotion is not installed in that folder. Run npm install (or your package manager's install) there first."
    : !entry
      ? "No Remotion entry file found (src/index.ts, or the one named in remotion.config.ts)."
      : compositions.length === 0
        ? "No <Composition> found in the source."
        : undefined;
  return {
    findings,
    blocked: findings.some((f) => f.severity === "blocker"),
    facts: readRemotionFacts(files, compositionId),
    sourceFiles: files.length,
    compositions,
    render: reason ? { ready: false, reason } : { ready: true },
  };
}

const REMOTION_LIMITS: CopyLimits = { maxFiles: 3000, maxBytes: 400_000_000 };

export interface RemotionImport {
  project: ProjectMeta;
  analysis: RemotionAnalysis;
  /** Sent to the director as the first message of the conversion. */
  prompt: string;
}

export function conversionPrompt(a: RemotionAnalysis): string {
  const notes = a.findings.filter((f) => f.severity !== "info");
  return `Convert the Remotion project in \`import/remotion/\` into this HyperFrames project (${a.facts.orientation}, ${a.facts.fps} fps). The Remotion source is a read-only reference: do not edit it. Build the result in \`index.html\` and \`compositions/\`, one scene file per Remotion scene.

How Remotion maps to HyperFrames (time is in SECONDS here, frames there: seconds = frames / ${a.facts.fps}):
- <Composition width height fps durationInFrames> → the root element's data-width, data-height, data-duration.
- <AbsoluteFill> → an absolutely positioned div with inset: 0.
- <Sequence from durationInFrames> → a clip or scene host with data-start and data-duration. <Series> → clips that start one after another.
- useCurrentFrame() + interpolate(frame, [a,b], [x,y]) → gsap.fromTo with the start state in the tween, at time a/fps, duration (b-a)/fps. Easing → the nearest GSAP ease. spring() → "back.out" or "power3.out" with a similar duration; say so in the notes.
- staticFile("x") and files in public/ → \`assets/public/x\` (already copied there). <Img>, <Video>, <Audio> → <img>, <video>, <audio id="…"> with root-relative paths.
- Google fonts → one of the bundled fonts if the same family exists, else a @font-face to a file you add under assets/fonts.
- Props with defaultProps → variables declared in data-composition-variables.
Read only the files you need (list_files, read_file). Run check after each scene and fix every error, then snapshot a few frames.
${notes.length > 0 ? `\nThe import flagged constructs that cannot be translated; drop them and record each in TRANSLATION_NOTES.md (write that file):\n${notes.map((f) => `- ${f.file}: ${f.message}`).join("\n")}\n` : "\nWrite TRANSLATION_NOTES.md listing anything you had to approximate.\n"}`;
}

export async function importRemotionProject(sourceDir: string, name?: string, opts: { force?: boolean } = {}): Promise<RemotionImport> {
  const analysis = await analyzeRemotionProject(sourceDir);
  if (analysis.blocked && !opts.force) {
    throw new Error(`This Remotion project uses constructs that cannot become a video: ${analysis.findings.filter((f) => f.severity === "blocker").map((f) => f.message).join(" ")}`);
  }
  const src = resolve(sourceDir);
  const project = await createProject({ name: name?.trim() || basename(src), orientation: analysis.facts.orientation, fps: analysis.facts.fps });
  const root = projectPath(project.id);
  try {
    await mkdir(join(root, "import"), { recursive: true });
    await copyProjectTree(src, join(root, "import", "remotion"), { limits: REMOTION_LIMITS, extraSkip: REMOTION_SKIP });
    // Remotion serves public/ at the root through staticFile(); the conversion uses assets/public/.
    if (existsSync(join(src, "public"))) await copyProjectTree(join(src, "public"), join(root, "assets", "public"), { limits: REMOTION_LIMITS });
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }
  return { project, analysis, prompt: conversionPrompt(analysis) };
}

export interface RemotionRender {
  project: ProjectMeta;
  analysis: RemotionAnalysis;
  seconds: number;
  hasAudio: boolean;
}

const RENDER_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_TAIL = 2000;

/** Run the project's own Remotion CLI with this process's Node; resolves with the tail of its output on failure. */
function runRemotion(cli: string, args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  const { promise, resolve: done, reject } = Promise.withResolvers<void>();
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, FORCE_COLOR: "0", CI: "1" }, stdio: ["ignore", "pipe", "pipe"], signal });
  let tail = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      tail = (tail + chunk).slice(-OUTPUT_TAIL);
    });
  }
  const timer = setTimeout(() => child.kill("SIGKILL"), RENDER_TIMEOUT_MS);
  child.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0) done();
    else reject(new Error(`Remotion render failed (exit ${code}): ${tail.trim().split(/\r|\n/).filter(Boolean).slice(-8).join("\n")}`));
  });
  return promise;
}

/**
 * The alternative to translating: render the Remotion composition with the project's own Remotion install and
 * play the finished mp4 as one clip. Everything Remotion can do survives (state, effects, UI libraries), but the
 * result is footage, not editable HTML.
 */
export async function renderRemotionProject(sourceDir: string, name: string | undefined, opts: { compositionId?: string; signal?: AbortSignal } = {}): Promise<RemotionRender> {
  const analysis = await analyzeRemotionProject(sourceDir, opts.compositionId);
  if (!analysis.render.ready) throw new Error(analysis.render.reason);
  const compositionId = opts.compositionId ?? analysis.compositions[0];
  // The id goes onto a command line: only an id read from the source is accepted.
  if (!compositionId || !analysis.compositions.includes(compositionId)) throw new Error(`This project has no composition “${opts.compositionId}”.`);
  const src = resolve(sourceDir);
  const [cli, entry] = await Promise.all([findRemotionCli(src), findRemotionEntry(src)]);
  if (!cli || !entry) throw new Error(analysis.render.reason);

  const project = await createProject({ name: name?.trim() || basename(src), orientation: analysis.facts.orientation, fps: analysis.facts.fps });
  const root = projectPath(project.id);
  try {
    const dir = join(root, "assets", "video");
    await mkdir(dir, { recursive: true });
    // Remotion picks the codec from the extension, so the temporary name still ends in .mp4.
    const tmp = join(dir, ".remotion.tmp.mp4");
    await runRemotion(cli, ["render", entry, compositionId, tmp, "--codec=h264", "--overwrite"], src, opts.signal);
    const info = await readMp4Info(tmp);
    await rename(tmp, join(dir, "remotion.mp4"));

    const indexFile = join(root, "index.html");
    const mounted = mountRenderedVideo(await readFile(indexFile, "utf8"), { src: "assets/video/remotion.mp4", seconds: info.seconds, hasAudio: info.hasAudio });
    if (!mounted) throw new Error("index.html has no root composition to place the video in.");
    await writeFile(`${indexFile}.part`, mounted);
    await rename(`${indexFile}.part`, indexFile);
    return { project, analysis, seconds: info.seconds, hasAudio: info.hasAudio };
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }
}
