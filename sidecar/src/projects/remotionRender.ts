import { open, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { setRootDuration } from "../engine/timeline.js";

// Helpers for turning a Remotion project into a finished video that a HyperFrames project plays as one clip.
// The Remotion CLI that renders it is the one installed in the user's own project (node_modules), so nothing
// is downloaded here and the version matches what they built against.

const ENTRY_CANDIDATES = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "index.ts", "index.tsx", "index.js", "index.jsx"];

/** The file that calls `registerRoot`: from `Config.setEntryPoint`, an npm script, or Remotion's own default names. */
export async function findRemotionEntry(src: string): Promise<string | null> {
  const read = async (name: string): Promise<string> => (existsSync(join(src, name)) ? readFile(join(src, name), "utf8").catch(() => "") : "");
  const declared: (string | undefined)[] = [];
  for (const cfg of ["remotion.config.ts", "remotion.config.js", "remotion.config.mjs"]) {
    declared.push(/setEntryPoint\(\s*["'`]([^"'`]+)["'`]/.exec(await read(cfg))?.[1]);
  }
  for (const m of (await read("package.json")).matchAll(/remotion\s+(?:render|studio|bundle|compositions|still)\s+([^\s"'&|;]+\.(?:tsx?|jsx?))/g)) declared.push(m[1]);
  return [...declared, ...ENTRY_CANDIDATES].find((p): p is string => !!p && existsSync(join(src, p))) ?? null;
}

/** The Remotion CLI script inside the project's node_modules, or null when dependencies were never installed. */
export async function findRemotionCli(src: string): Promise<string | null> {
  const dir = join(src, "node_modules", "@remotion", "cli");
  const pkg = await readFile(join(dir, "package.json"), "utf8").catch(() => null);
  if (!pkg) return null;
  // package.json comes from the user's disk: validate the one field read instead of trusting a cast.
  const parsed = z.object({ bin: z.union([z.string(), z.record(z.string(), z.string())]).optional() }).safeParse(JSON.parse(pkg || "{}"));
  const bin = parsed.success ? parsed.data.bin : undefined;
  const rel = typeof bin === "string" ? bin : bin?.remotion;
  const file = join(dir, rel ?? "remotion-cli.js");
  return existsSync(file) ? file : null;
}

export interface Mp4Info {
  seconds: number;
  hasAudio: boolean;
}

interface Box {
  type: string;
  start: number;
  payload: number;
  end: number;
}

function boxesIn(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      head = 16;
    } else if (size === 0) size = to - at;
    if (size < head || at + size > to) break;
    out.push({ type: buf.toString("latin1", at + 4, at + 8), start: at, payload: at + head, end: at + size });
    at += size;
  }
  return out;
}

/** Length and whether there is a sound track, read from the `moov` box. No ffprobe needed. */
export async function readMp4Info(file: string): Promise<Mp4Info> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    let at = 0;
    while (at + 8 <= size) {
      await fh.read(head, 0, 16, at);
      let boxSize = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (boxSize === 1) boxSize = Number(head.readBigUInt64BE(8));
      else if (boxSize === 0) boxSize = size - at;
      if (boxSize < 8) break;
      if (type === "moov") {
        const moov = Buffer.alloc(boxSize);
        await fh.read(moov, 0, boxSize, at);
        return parseMoov(moov);
      }
      at += boxSize;
    }
  } finally {
    await fh.close();
  }
  throw new Error("The rendered file has no readable length (no moov box).");
}

function parseMoov(moov: Buffer): Mp4Info {
  const top = boxesIn(moov, 8, moov.length);
  const mvhd = top.find((b) => b.type === "mvhd");
  if (!mvhd) throw new Error("The rendered file has no movie header.");
  const v = moov.readUInt8(mvhd.payload);
  const movieScale = v === 1 ? moov.readUInt32BE(mvhd.payload + 20) : moov.readUInt32BE(mvhd.payload + 12);
  const movieTicks = v === 1 ? Number(moov.readBigUInt64BE(mvhd.payload + 24)) : moov.readUInt32BE(mvhd.payload + 16);
  if (!movieScale || !movieTicks) throw new Error("The rendered file reports no length.");

  let hasAudio = false;
  let videoTicks = 0;
  for (const trak of top.filter((b) => b.type === "trak")) {
    const mdia = boxesIn(moov, trak.payload, trak.end).find((b) => b.type === "mdia");
    const hdlr = mdia && boxesIn(moov, mdia.payload, mdia.end).find((b) => b.type === "hdlr");
    // hdlr payload: version+flags (4), pre_defined (4), handler_type (4)
    const handler = hdlr ? moov.toString("latin1", hdlr.payload + 8, hdlr.payload + 12) : "";
    if (handler === "soun") hasAudio = true;
    if (handler === "vide") {
      // The movie length also counts audio padding (Remotion's comes out a few frames longer than the picture),
      // so the clip is as long as the picture. tkhd duration is in movie ticks.
      const tkhd = boxesIn(moov, trak.payload, trak.end).find((b) => b.type === "tkhd");
      if (tkhd) videoTicks = moov.readUInt8(tkhd.payload) === 1 ? Number(moov.readBigUInt64BE(tkhd.payload + 28)) : moov.readUInt32BE(tkhd.payload + 20);
    }
  }
  return { seconds: (videoTicks || movieTicks) / movieScale, hasAudio };
}

export const REMOTION_CLIP_ID = "remotion-render";

/**
 * Put the rendered video into the root composition as one full-frame clip and stretch the project to its length.
 * Running it again replaces the earlier clip. The clip goes right after the root's opening tag.
 */
export function mountRenderedVideo(html: string, o: { src: string; seconds: number; hasAudio: boolean }): string | null {
  const length = Math.ceil(o.seconds * 100) / 100;
  const sized = setRootDuration(html, length);
  if (!sized) return null;
  const clip = `<video id="${REMOTION_CLIP_ID}" src="${o.src}" data-start="0" data-duration="${length}" data-track-index="0"${o.hasAudio ? ' data-has-audio="true"' : ""} playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video>`;
  // The blank template ships a placeholder title; it would sit on top of the video.
  const out = sized.html.replace(new RegExp(`<video\\b[^>]*\\bid="${REMOTION_CLIP_ID}"[^>]*>\\s*</video>`, "g"), "").replace(/<h1\s+id="title"[^>]*>[^<]*<\/h1>\s*/, "");
  for (const tag of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tag[0];
    if (!/\bdata-composition-id=/.test(t) || /\bdata-composition-src=/.test(t)) continue;
    const at = (tag.index ?? 0) + t.length;
    return `${out.slice(0, at)}\n      ${clip}${out.slice(at)}`;
  }
  return null;
}
