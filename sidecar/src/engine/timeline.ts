import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runCli } from "./cli.js";
import { parseJsonTail } from "./tools.js";
import { projectPath, touch } from "../projects/store.js";

/** One clip as the timeline UI needs it. Times are seconds; `start`/`end` are local to the clip's own file. */
export interface TimelineClip {
  /** Pass back verbatim to edit: `#id` or `hf:<stable id>` for elements without an id. */
  ref: string;
  id: string;
  /** HTML tag name: h1, p, video, audio, img, div (a mounted scene)… */
  tag: string;
  trackKind: string;
  trackIndex: number;
  start: number;
  duration: number;
  end: number;
  absStart: number;
  absEnd: number;
  file: string;
  src: string | null;
  /** True for a clip that lives inside a mounted scene file; its times are local to that scene. */
  nested: boolean;
  host: string | null;
  /** `absStart - start`: add to a local time to get project time, subtract to go back. */
  offset: number;
  mediaStart: number | null;
  warnings: string[];
}

export interface TimelineView {
  duration: number;
  clips: TimelineClip[];
  canUndo: boolean;
  canRedo: boolean;
}

const Row = z.looseObject({
  id: z.string(),
  ref: z.string(),
  kind: z.string(),
  trackKind: z.string(),
  trackIndex: z.number().nullable(),
  start: z.number(),
  duration: z.number(),
  end: z.number(),
  absStart: z.number(),
  absEnd: z.number(),
  file: z.string(),
  src: z.string().nullable().optional(),
  nested: z.boolean(),
  host: z.string().nullable().optional(),
  mediaStart: z.number().nullable().optional(),
  warnings: z.array(z.unknown()).default([]),
});

const TimelineJson = z.looseObject({
  timeline: z.looseObject({
    duration: z.number(),
    tracks: z.array(z.looseObject({ rows: z.array(Row) })),
  }),
});

// ── history ──────────────────────────────────────────────────────────────────────────────

/** Undo entries are self-contained: a CLI receipt, or a project-length change (which the CLI cannot do). */
const Entry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cli"), receipt: z.unknown() }),
  z.object({ kind: z.literal("length"), before: z.number(), after: z.number() }),
  /** Lane (data-track-index) changes, which the CLI cannot make. `before` null: the attribute was absent. */
  z.object({
    kind: z.literal("lane"),
    changes: z.array(z.object({ file: z.string(), ref: z.string(), before: z.number().nullable(), after: z.number().nullable() })),
  }),
]);
type HistoryEntry = z.infer<typeof Entry>;

const History = z.object({ undo: z.array(Entry), redo: z.array(Entry) });
type History = z.infer<typeof History>;

const MAX_HISTORY = 100;

function historyFile(projectId: string): string {
  return join(projectPath(projectId), ".memotion", "timeline-history.json");
}

async function loadHistory(projectId: string): Promise<History> {
  try {
    return History.parse(JSON.parse(await readFile(historyFile(projectId), "utf8")));
  } catch {
    return { undo: [], redo: [] };
  }
}

async function saveHistory(projectId: string, h: History): Promise<void> {
  const file = historyFile(projectId);
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.part`;
  await writeFile(tmp, JSON.stringify({ undo: h.undo.slice(-MAX_HISTORY), redo: h.redo.slice(-MAX_HISTORY) }));
  await rename(tmp, file);
}

// ── serialisation: edits to one project never overlap ────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

function serialized<T>(projectId: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(projectId) ?? Promise.resolve()).then(job, job);
  queues.set(projectId, run.catch(() => undefined));
  return run;
}

// ── read ────────────────────────────────────────────────────────────────────────────────

export async function readTimeline(projectId: string, signal?: AbortSignal): Promise<TimelineView> {
  const res = await runCli(["timeline", "--json"], { cwd: projectPath(projectId), signal, timeoutMs: 60_000 });
  const parsed = TimelineJson.safeParse(parseJsonTail(res.stdout));
  if (!parsed.success) throw new Error(`Could not read the timeline: ${(res.stderr || res.stdout).slice(-600)}`);

  const clips: TimelineClip[] = [];
  for (const track of parsed.data.timeline.tracks) {
    for (const r of track.rows) {
      clips.push({
        ref: r.ref,
        id: r.id,
        tag: r.kind,
        trackKind: r.trackKind,
        trackIndex: r.trackIndex ?? 0,
        start: r.start,
        duration: r.duration,
        end: r.end,
        absStart: r.absStart,
        absEnd: r.absEnd,
        file: r.file,
        src: r.src ?? null,
        nested: r.nested,
        host: r.host ?? null,
        offset: r.absStart - r.start,
        mediaStart: r.mediaStart ?? null,
        warnings: r.warnings.map((w) => (typeof w === "string" ? w : JSON.stringify(w))),
      });
    }
  }
  const h = await loadHistory(projectId);
  return { duration: parsed.data.timeline.duration, clips, canUndo: h.undo.length > 0, canRedo: h.redo.length > 0 };
}

// ── edit ────────────────────────────────────────────────────────────────────────────────

/** `#id` or `hf:<id>`. Validated because the value becomes a CLI argument (a leading `-` would be a flag). */
const Ref = z.string().regex(/^(#[A-Za-z_][\w-]*|hf:[\w-]+)$/);

const BatchEdit = z.discriminatedUnion("verb", [
  z.object({ verb: z.literal("move"), ref: Ref, start: z.number().min(0) }),
  z.object({ verb: z.literal("trim"), ref: Ref, start: z.number().min(0).optional(), end: z.number().positive().optional() }).refine((v) => v.start !== undefined || v.end !== undefined),
  z.object({ verb: z.literal("split"), ref: Ref, at: z.number().positive() }),
  z.object({ verb: z.literal("duplicate"), ref: Ref }),
  z.object({ verb: z.literal("delete"), ref: Ref }),
]);

export const EditOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), ref: Ref, start: z.number().min(0), overwrite: z.boolean().optional() }),
  z
    .object({
      op: z.literal("trim"),
      ref: Ref,
      start: z.number().min(0).optional(),
      end: z.number().positive().optional(),
      overwrite: z.boolean().optional(),
    })
    // `--end` alone trims the right edge; `--start` alone MOVES the clip (duration kept); both together trim the left edge.
    .refine((v) => v.start !== undefined || v.end !== undefined, "give start, end, or both"),
  z.object({ op: z.literal("split"), ref: Ref, at: z.number().positive() }),
  z.object({ op: z.literal("duplicate"), ref: Ref }),
  z.object({ op: z.literal("delete"), ref: Ref }),
  z.object({ op: z.literal("length"), seconds: z.number().min(0.5).max(3600) }),
  /** Several edits as one atomic step: all are applied or none, and one undo reverts them all (`timeline apply`). */
  z.object({ op: z.literal("batch"), edits: z.array(BatchEdit).min(1).max(100) }),
  /** Move clips to another lane of their own kind. The render never reads lanes; they are for the timeline. */
  z.object({ op: z.literal("lane"), moves: z.array(z.object({ ref: Ref, track: z.number().int().min(0).max(50) })).min(1).max(100) }),
]);
export type EditOp = z.infer<typeof EditOp>;

export type EditResult = { ok: true } | { ok: false; reason: string; fix?: string };

const CliEdit = z.looseObject({
  ok: z.boolean(),
  reason: z.string().optional(),
  fix: z.string().optional(),
  receipt: z.unknown().optional(),
});

const round = (n: number): string => String(Math.round(n * 1000) / 1000);

function cliArgs(op: Exclude<EditOp, { op: "length" | "batch" | "lane" }>): string[] {
  const overwrite = "overwrite" in op && op.overwrite ? ["--overwrite"] : [];
  switch (op.op) {
    case "move":
      return ["timeline", "move", op.ref, round(op.start), ...overwrite, "--json"];
    case "trim":
      return [
        "timeline",
        "trim",
        op.ref,
        ...(op.start !== undefined ? ["--start", round(op.start)] : []),
        ...(op.end !== undefined ? ["--end", round(op.end)] : []),
        ...overwrite,
        "--json",
      ];
    case "split":
      return ["timeline", "split", op.ref, round(op.at), "--json"];
    case "duplicate":
      return ["timeline", "duplicate", op.ref, "--json"];
    case "delete":
      return ["timeline", "delete", op.ref, "--json"];
  }
}

/** Replace `data-duration` on the root composition element (the one with an id and no `data-composition-src`). */
export function setRootDuration(html: string, seconds: number): { html: string; before: number } | null {
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tag[0];
    if (!/\bdata-composition-id=/.test(t) || /\bdata-composition-src=/.test(t)) continue;
    const m = /\bdata-duration=(["'])([^"']*)\1/.exec(t);
    if (!m) continue;
    const before = Number(m[2]);
    const fixed = t.replace(m[0], `data-duration=${m[1]}${round(seconds)}${m[1]}`);
    return { html: html.slice(0, tag.index) + fixed + html.slice(tag.index + t.length), before };
  }
  return null;
}

async function applyLength(projectId: string, seconds: number): Promise<{ before: number } | { error: string }> {
  const file = join(projectPath(projectId), "index.html");
  const patched = setRootDuration(await readFile(file, "utf8"), seconds);
  if (!patched) return { error: "index.html has no root composition with a data-duration." };
  const tmp = `${file}.part`;
  await writeFile(tmp, patched.html);
  await rename(tmp, file);
  return { before: patched.before };
}

/** The CLI's plan form of a batch: one JSON array of `{verb, ref, ...}`, times as strings. */
export function planFor(edits: Extract<EditOp, { op: "batch" }>["edits"]): unknown[] {
  return edits.map((e) => {
    switch (e.verb) {
      case "move":
        return { verb: "move", ref: e.ref, time: round(e.start) };
      case "trim":
        return { verb: "trim", ref: e.ref, ...(e.start !== undefined ? { start: round(e.start) } : {}), ...(e.end !== undefined ? { end: round(e.end) } : {}) };
      case "split":
        return { verb: "split", ref: e.ref, time: round(e.at) };
      case "duplicate":
      case "delete":
        return { verb: e.verb, ref: e.ref };
    }
  });
}

async function runPlan(projectId: string, edits: Extract<EditOp, { op: "batch" }>["edits"], signal?: AbortSignal) {
  const dir = await mkdtemp(join(tmpdir(), "memotion-plan-"));
  try {
    const file = join(dir, "plan.json");
    await writeFile(file, JSON.stringify(planFor(edits)));
    return await runCli(["timeline", "apply", file, "--json"], { cwd: projectPath(projectId), signal, timeoutMs: 120_000 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── lanes ────────────────────────────────────────────────────────────────────────────────

/** The opening tag of the element a ref names: `#id` by its id, `hf:x` by its data-hf-id. */
function findTag(html: string, ref: string): { index: number; tag: string } | null {
  const name = ref.startsWith("#") ? ref.slice(1) : ref.slice(3);
  const attr = ref.startsWith("#") ? "id" : "data-hf-id";
  const wanted = new RegExp(`(?<![\\w-])${attr}=(["'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) if (wanted.test(m[0])) return { index: m.index ?? 0, tag: m[0] };
  return null;
}

/** Set (or add, or with null remove) `data-track-index` on one element. Pure, so it can be checked without files. */
export function setTrackIndex(html: string, ref: string, track: number | null): { html: string; before: number | null } | null {
  const found = findTag(html, ref);
  if (!found) return null;
  const existing = /(?<![\w-])data-track-index=(["'])([^"']*)\1/.exec(found.tag);
  const before = existing && Number.isFinite(Number(existing[2])) ? Number(existing[2]) : null;
  let tag: string;
  if (existing) tag = track === null ? found.tag.replace(new RegExp(`\\s+${existing[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "") : found.tag.replace(existing[0], `data-track-index=${existing[1]}${track}${existing[1]}`);
  else if (track === null) tag = found.tag;
  else tag = found.tag.replace(/\s*(\/?)>$/, ` data-track-index="${track}"$1>`);
  return { html: html.slice(0, found.index) + tag + html.slice(found.index + found.tag.length), before };
}

type LaneChange = { file: string; ref: string; before: number | null; after: number | null };

async function writeLaneChanges(projectId: string, changes: LaneChange[], direction: "after" | "before"): Promise<string | null> {
  const root = projectPath(projectId);
  const byFile = new Map<string, LaneChange[]>();
  for (const c of changes) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  const patched = new Map<string, string>();
  for (const [file, list] of byFile) {
    let html = await readFile(join(root, file), "utf8");
    for (const c of list) {
      const res = setTrackIndex(html, c.ref, c[direction]);
      if (!res) return `${c.ref} was not found in ${file}.`;
      html = res.html;
    }
    patched.set(file, html);
  }
  // Every file is patched in memory first: a ref that cannot be found must not leave some files changed.
  for (const [file, html] of patched) {
    const target = join(root, file);
    const tmp = `${target}.part`;
    await writeFile(tmp, html);
    await rename(tmp, target);
  }
  return null;
}

/** Where `moves` would put the clips, or the reason they cannot go: a lane only holds one clip at a time. */
export function planLaneMoves(clips: TimelineClip[], moves: { ref: string; track: number }[]): { ok: true; changes: { clip: TimelineClip; track: number }[] } | { ok: false; reason: string } {
  const chosen = new Map(moves.map((m) => [m.ref, m.track]));
  const changes: { clip: TimelineClip; track: number }[] = [];
  for (const m of moves) {
    const clip = clips.find((c) => c.ref === m.ref);
    if (!clip) return { ok: false, reason: `${m.ref} is not on the timeline.` };
    if (clip.trackIndex !== m.track) changes.push({ clip, track: m.track });
  }
  if (changes.length === 0) return { ok: false, reason: "Those clips are already in that lane." };
  const lane = (c: TimelineClip, track: number) => `${c.file}|${c.trackKind}|${c.host ?? ""}|${track}`;
  const placed = clips.map((c) => ({ c, key: lane(c, chosen.get(c.ref) ?? c.trackIndex) }));
  for (const a of placed) {
    for (const b of placed) {
      if (a.c.ref >= b.c.ref || a.key !== b.key) continue;
      if (a.c.absStart < b.c.absEnd - 1e-6 && b.c.absStart < a.c.absEnd - 1e-6) {
        return { ok: false, reason: `${a.c.id} and ${b.c.id} would overlap in that lane.` };
      }
    }
  }
  return { ok: true, changes };
}

export function editTimeline(projectId: string, op: EditOp, signal?: AbortSignal): Promise<EditResult> {
  return serialized(projectId, async () => {
    const h = await loadHistory(projectId);
    let entry: HistoryEntry;

    if (op.op === "length") {
      const res = await applyLength(projectId, op.seconds);
      if ("error" in res) return { ok: false, reason: res.error };
      entry = { kind: "length", before: res.before, after: op.seconds };
    } else if (op.op === "lane") {
      const view = await readTimeline(projectId, signal);
      const plan = planLaneMoves(view.clips, op.moves);
      if (!plan.ok) return { ok: false, reason: plan.reason };
      const changes: LaneChange[] = plan.changes.map((x) => ({ file: x.clip.file, ref: x.clip.ref, before: x.clip.trackIndex, after: x.track }));
      const failed = await writeLaneChanges(projectId, changes, "after");
      if (failed) return { ok: false, reason: failed };
      entry = { kind: "lane", changes };
    } else if (op.op === "batch") {
      const res = await runPlan(projectId, op.edits, signal);
      const parsed = CliEdit.safeParse(parseJsonTail(res.stdout) ?? parseJsonTail(res.stderr));
      if (!parsed.success) return { ok: false, reason: (res.stderr || res.stdout).slice(-500) || `exit ${res.code}` };
      if (!parsed.data.ok) return { ok: false, reason: (parsed.data.reason ?? "edit refused").replace(/^timeline apply: /, ""), fix: parsed.data.fix };
      entry = { kind: "cli", receipt: parsed.data.receipt };
    } else {
      const res = await runCli(cliArgs(op), { cwd: projectPath(projectId), signal, timeoutMs: 60_000 });
      // Refusals (`ok:false`) are printed on stderr by some commands, success and others on stdout.
      const parsed = CliEdit.safeParse(parseJsonTail(res.stdout) ?? parseJsonTail(res.stderr));
      if (!parsed.success) return { ok: false, reason: (res.stderr || res.stdout).slice(-500) || `exit ${res.code}` };
      if (!parsed.data.ok) return { ok: false, reason: parsed.data.reason ?? "edit refused", fix: parsed.data.fix };
      entry = { kind: "cli", receipt: parsed.data.receipt };
    }

    h.undo.push(entry);
    h.redo = [];
    await saveHistory(projectId, h);
    await touch(projectId);
    return { ok: true };
  });
}

/** Revert one entry. Returns the entry that reverses the reversal (so redo is just undo of the undo). */
async function revert(projectId: string, entry: HistoryEntry, signal?: AbortSignal): Promise<HistoryEntry | { error: string }> {
  if (entry.kind === "length") {
    const res = await applyLength(projectId, entry.before);
    return "error" in res ? res : { kind: "length", before: entry.after, after: entry.before };
  }
  if (entry.kind === "lane") {
    const failed = await writeLaneChanges(projectId, entry.changes, "before");
    return failed ? { error: failed } : { kind: "lane", changes: entry.changes.map((c) => ({ ...c, before: c.after, after: c.before })) };
  }
  const res = await runCli(["timeline", "undo", JSON.stringify(entry.receipt), "--json"], {
    cwd: projectPath(projectId),
    signal,
    timeoutMs: 60_000,
  });
  const parsed = CliEdit.safeParse(parseJsonTail(res.stdout) ?? parseJsonTail(res.stderr));
  if (!parsed.success) return { error: (res.stderr || res.stdout).slice(-500) || `exit ${res.code}` };
  // A refused undo (the file changed since the edit) must not eat the entry: the caller keeps it on its stack.
  if (!parsed.data.ok) return { error: parsed.data.reason ?? "undo refused" };
  return { kind: "cli", receipt: parsed.data.receipt };
}

export function undoTimeline(projectId: string, direction: "undo" | "redo", signal?: AbortSignal): Promise<EditResult> {
  return serialized(projectId, async () => {
    const h = await loadHistory(projectId);
    const from = direction === "undo" ? h.undo : h.redo;
    const to = direction === "undo" ? h.redo : h.undo;
    const entry = from.at(-1);
    if (!entry) return { ok: false, reason: `Nothing to ${direction}.` };

    const reversed = await revert(projectId, entry, signal);
    if ("error" in reversed) return { ok: false, reason: reversed.error };
    from.pop();
    to.push(reversed);
    await saveHistory(projectId, h);
    await touch(projectId);
    return { ok: true };
  });
}
