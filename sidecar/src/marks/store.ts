import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { projectPath } from "../projects/store.js";

// ── what the preview page tells us about an element ──────────────────────────────────────
// All of it comes from a web page, so every field is bounded before it is stored or shown to a model.

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const Target = z.object({
  selector: z.string().min(1).max(300),
  id: z.string().max(100).nullish(),
  tag: z.string().max(30),
  classes: z.array(z.string().max(60)).max(10).default([]),
  text: z.string().max(200).nullish(),
  media: z.string().max(300).nullish(),
  rect: Rect,
  compositionId: z.string().max(100).nullish(),
  compositionFile: z.string().max(200).nullish(),
  start: z.string().max(20).nullish(),
  duration: z.string().max(20).nullish(),
  styles: z.record(z.string(), z.string().max(120)).default({}),
});
export type Target = z.infer<typeof Target>;

const MARK_IMAGE = /^\.memotion\/marks\/mark-[a-z0-9]+\.png$/;

export const Selection = z.object({ target: Target, time: z.number().min(0) });
export const Drawing = z.object({
  imagePath: z.string().regex(MARK_IMAGE),
  note: z.string().max(500).default(""),
  hits: z.array(Target).max(12).default([]),
  time: z.number().min(0),
});

export const ChatContext = z.object({
  selection: Selection.optional(),
  drawing: Drawing.optional(),
  commentIds: z.array(z.string().regex(/^[a-f0-9]{12}$/)).max(50).optional(),
});
export type ChatContext = z.infer<typeof ChatContext>;

// ── comments ─────────────────────────────────────────────────────────────────────────────

export const CommentInput = z.object({
  time: z.number().min(0),
  x: z.number(),
  y: z.number(),
  text: z.string().trim().min(1).max(1000),
  target: Target.optional(),
});
export type CommentInput = z.infer<typeof CommentInput>;

const Comment = CommentInput.extend({
  id: z.string().regex(/^[a-f0-9]{12}$/),
  status: z.enum(["open", "sent"]),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

const MAX_COMMENTS = 200;
const commentsFile = (projectId: string): string => join(projectPath(projectId), ".memotion", "comments.json");

export async function listComments(projectId: string): Promise<Comment[]> {
  try {
    return z.array(Comment).parse(JSON.parse(await readFile(commentsFile(projectId), "utf8")));
  } catch {
    return [];
  }
}

async function saveComments(projectId: string, comments: Comment[]): Promise<void> {
  const file = commentsFile(projectId);
  await mkdir(join(file, ".."), { recursive: true });
  const tmp = `${file}.part`;
  await writeFile(tmp, JSON.stringify(comments));
  await rename(tmp, file);
}

export async function addComment(projectId: string, input: CommentInput): Promise<Comment> {
  const all = await listComments(projectId);
  if (all.length >= MAX_COMMENTS) throw new Error(`A project can hold ${MAX_COMMENTS} comments. Delete some first.`);
  const comment: Comment = { ...input, id: randomBytes(6).toString("hex"), status: "open", createdAt: new Date().toISOString() };
  await saveComments(projectId, [...all, comment]);
  return comment;
}

export async function deleteComment(projectId: string, id: string): Promise<boolean> {
  const all = await listComments(projectId);
  const kept = all.filter((c) => c.id !== id);
  if (kept.length === all.length) return false;
  await saveComments(projectId, kept);
  return true;
}

export async function markCommentsSent(projectId: string, ids: string[]): Promise<void> {
  const all = await listComments(projectId);
  await saveComments(projectId, all.map((c) => (ids.includes(c.id) ? { ...c, status: "sent" as const } : c)));
}

// ── mark images (a frame with the user's drawing on it) ──────────────────────────────────

const MAX_IMAGE_BYTES = 8_000_000;
const KEEP_IMAGES = 20;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function saveMarkImage(projectId: string, bytes: Buffer): Promise<string> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("That image is too large.");
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("Only PNG images can be attached.");
  const dir = join(projectPath(projectId), ".memotion", "marks");
  await mkdir(dir, { recursive: true });
  const name = `mark-${Date.now().toString(36)}${randomBytes(3).toString("hex")}.png`;
  await writeFile(join(dir, name), bytes);
  // Old ones are only useful for the conversation that sent them.
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_IMAGES))) await rm(join(dir, old), { force: true });
  return `.memotion/marks/${name}`;
}

// ── turning marks into words for the director ────────────────────────────────────────────

const sec = (t: number): string => `${t.toFixed(1)} s`;

export function describeTarget(t: Target): string {
  const head = `\`${t.selector}\` <${t.tag}>${t.text ? ` showing "${t.text}"` : ""}${t.media ? ` (${t.media})` : ""}`;
  const where = [t.compositionFile ? `in ${t.compositionFile}` : null, t.compositionId ? `composition "${t.compositionId}"` : null].filter(Boolean).join(", ");
  const timing = t.start ? `, timed start=${t.start}${t.duration ? ` duration=${t.duration}` : ""}` : "";
  const box = `on screen at x=${t.rect.x} y=${t.rect.y}, ${t.rect.w}×${t.rect.h} px`;
  const style = Object.entries(t.styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return `${head}${where ? `, ${where}` : ""}${timing}\n    ${box}${style ? `\n    computed style: ${style}` : ""}`;
}

export interface RenderedContext {
  text: string;
  images: Buffer[];
}

/** The marks as text the director reads, plus the annotated frame to show a model that can see images. */
export async function renderContext(projectId: string, ctx: ChatContext): Promise<RenderedContext> {
  const lines: string[] = [];
  const images: Buffer[] = [];

  if (ctx.selection) {
    lines.push(`Selected element (at ${sec(ctx.selection.time)}):\n  ${describeTarget(ctx.selection.target)}`);
  }
  if (ctx.drawing) {
    const d = ctx.drawing;
    const hits = d.hits.length > 0 ? `\n  Elements under the drawing:\n${d.hits.map((h) => `   - ${describeTarget(h)}`).join("\n")}` : "";
    lines.push(`Drawing on the frame at ${sec(d.time)}${d.note ? `, with the note: "${d.note}"` : ""}.\n  The annotated frame is saved at ${d.imagePath} (open it with your file tool if you can view images).${hits}`);
    try {
      images.push(await readFile(join(projectPath(projectId), d.imagePath)));
    } catch {
      // The image was pruned or never saved: the text above still stands.
    }
  }
  if (ctx.commentIds && ctx.commentIds.length > 0) {
    const all = await listComments(projectId);
    const picked = ctx.commentIds.flatMap((id) => all.filter((c) => c.id === id));
    picked.forEach((c, i) => {
      lines.push(`Comment ${i + 1} (at ${sec(c.time)}, pinned at x=${Math.round(c.x)} y=${Math.round(c.y)}${c.target ? `, on ${describeTarget(c.target)}` : ""}):\n  "${c.text}"`);
    });
  }
  if (lines.length === 0) return { text: "", images };

  const text = [
    "[The user marked the preview. These marks say WHERE to change something; the message above says WHAT.]",
    ...lines,
    "Find the marked element in the project files by its id or selector (search for it), change only what the marks and the message refer to, and keep everything else as it is.",
  ].join("\n\n");
  return { text, images };
}
