import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setRootDuration } from "../engine/timeline.js";
import { projectPath, readMeta, touch } from "../projects/store.js";
import type { CaptionRequest, WordTiming } from "./types.js";

export interface CaptionGroup {
  words: WordTiming[];
  start: number;
  end: number;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A group ends at a sentence/clause mark, at a pause of 250 ms or more, or at the word limit. */
export function groupWords(words: WordTiming[], maxPerGroup: number = 3): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: WordTiming[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    current.push(w);
    const next = words[i + 1];
    const endsClause = /[,.!?:;]$/.test(w.text);
    const pause = next ? next.start - w.end : 0;
    if (!next || current.length >= maxPerGroup || endsClause || pause >= 0.25) {
      const first = current[0];
      if (first) groups.push({ words: current, start: first.start, end: w.end });
      current = [];
    }
  }
  return groups;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Per-style look. Everything dynamic is validated upstream (colours are hex, the font is a plain name). */
function styleCss(style: CaptionRequest["style"]): string {
  switch (style) {
    case "clean":
      return `font-weight: 600; text-transform: none; letter-spacing: 0; padding: 14px 28px; border-radius: 18px; background: rgba(10, 10, 12, 0.62); text-shadow: none;`;
    case "classic":
      return `font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; text-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9);`;
    case "pop":
    case "highlight":
      return `font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; text-shadow: 0 4px 12px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9);`;
  }
}

function groupTweens(g: CaptionGroup, gi: number, o: CaptionRequest): string {
  const sel = `#cg-${gi}`;
  const end = round3(Math.max(g.start + 0.15, g.end));
  const lines: string[] = [
    `// group ${gi}: ${round3(g.start)}s-${end}s`,
    `tl.set("${sel}", { display: "flex", opacity: 0 }, ${round3(g.start)});`,
  ];

  // How the group as a whole arrives.
  if (o.style === "classic") {
    lines.push(`tl.fromTo("${sel}", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.2, ease: "power3.out" }, ${round3(g.start)});`);
  } else if (o.style === "clean") {
    lines.push(`tl.fromTo("${sel}", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, ${round3(g.start)});`);
  } else {
    lines.push(`tl.to("${sel}", { opacity: 1, duration: 0.12, ease: "power2.out" }, ${round3(g.start)});`);
  }

  // Word-level motion, for the two styles that follow the voice word by word.
  g.words.forEach((w, wi) => {
    const wsel = `#cg-${gi}-w-${wi}`;
    const at = round3(w.start);
    const after = round3(Math.max(w.end, w.start + 0.1));
    if (o.style === "highlight") {
      lines.push(`tl.to("${wsel}", { color: "${o.accentColor}", scale: 1.08, duration: 0.12, ease: "power1.out" }, ${at});`);
      lines.push(`tl.to("${wsel}", { color: "${o.primaryColor}", scale: 1, duration: 0.1 }, ${after});`);
    } else if (o.style === "pop") {
      // Hidden until spoken, then it pops in; without the initial set a word would show fully, then shrink.
      lines.push(`tl.set("${wsel}", { opacity: 0, scale: 0.7 }, ${round3(g.start)});`);
      lines.push(`tl.to("${wsel}", { opacity: 1, scale: 1.12, color: "${o.accentColor}", duration: 0.14, ease: "back.out(2)" }, ${at});`);
      lines.push(`tl.to("${wsel}", { scale: 1, color: "${o.primaryColor}", duration: 0.12 }, ${round3(at + 0.14)});`);
    }
  });

  lines.push(`tl.to("${sel}", { opacity: 0, duration: 0.12, ease: "power2.in" }, ${round3(end - 0.12)});`);
  lines.push(`tl.set("${sel}", { display: "none" }, ${end});`);
  return lines.join("\n    ");
}

/** The caption scene file: one group per spoken phrase, one timeline, nothing but the words and their timing. */
export function generateCaptionHtml(groups: CaptionGroup[], opts: CaptionRequest, width: number, height: number): string {
  const portrait = height > width;
  const placement =
    opts.position === "center"
      ? "top: 50%; transform: translateY(-50%);"
      : opts.position === "top"
        ? "top: 120px;"
        : `bottom: ${portrait ? 420 : 100}px;`;

  const markup = groups
    .map((g, gi) => {
      const spans = g.words
        .map((w, wi) => `<span id="cg-${gi}-w-${wi}" class="cap-word" style="color: ${opts.primaryColor}">${escapeHtml(w.text)}</span>`)
        .join(" ");
      return `<div id="cg-${gi}" class="cap-group" style="display: none; opacity: 0;">${spans}</div>`;
    })
    .join("\n      ");

  return `<template>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    #root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; font-family: ${opts.fontFamily}, system-ui, sans-serif; }
    .cap-stage { position: absolute; left: 5%; right: 5%; ${placement} display: flex; justify-content: center; align-items: center; }
    .cap-group { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 16px; font-size: ${opts.fontSize}px; line-height: 1.2; text-align: center; ${styleCss(opts.style)} }
    .cap-word { display: inline-block; transform-origin: 50% 50%; }
  </style>
  <div id="root" data-composition-id="captions" data-width="${width}" data-height="${height}">
    <div class="cap-stage">
      ${markup}
    </div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${groups.map((g, gi) => groupTweens(g, gi, opts)).join("\n    ")}
    window.__timelines["captions"] = tl;
  </script>
</template>
`;
}

// ── mounting into index.html ─────────────────────────────────────────────────────────────

export interface MountOptions {
  width: number;
  height: number;
  /** Length of the whole speech; the video is lengthened to cover it, never shortened. */
  speechSeconds: number;
  audioSrc?: string;
  audioSeconds?: number;
}

/**
 * Put the voiceover `<audio>` and the captions host into the root composition. Running it again replaces the two
 * elements instead of adding more, and both are placed right after the root's opening tag with an explicit
 * z-index, so there is no need to find the root's closing tag (a regex cannot do that reliably).
 */
export function mountCaptions(html: string, o: MountOptions): string | null {
  // Never shorten the video: take the longer of its current length and what the speech needs.
  const current = setRootDuration(html, 1);
  if (!current) return null;
  const length = Math.max(current.before, Math.ceil(o.speechSeconds + 0.5));
  const withLength = setRootDuration(html, length);
  if (!withLength) return null;
  let out = withLength.html;

  const audio = o.audioSrc
    ? `<audio id="voiceover" src="${escapeHtml(o.audioSrc)}" data-start="0" data-duration="${round3(o.audioSeconds ?? o.speechSeconds)}" data-volume="1"></audio>`
    : "";
  const host = `<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${length}" data-track-kind="captions" data-track-index="0" data-width="${o.width}" data-height="${o.height}" style="z-index: 100"></div>`;

  // Remove earlier copies (this function's own output), then insert fresh ones.
  out = out.replace(/<audio\b[^>]*\bid="voiceover"[^>]*>\s*(<\/audio>)?/g, "");
  out = out.replace(/<div\b[^>]*\bdata-composition-id="captions"[^>]*>\s*<\/div>/g, "");

  for (const tag of out.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tag[0];
    if (!/\bdata-composition-id=/.test(t) || /\bdata-composition-src=/.test(t) || /\bdata-composition-id="captions"/.test(t)) continue;
    const at = (tag.index ?? 0) + t.length;
    return `${out.slice(0, at)}\n      ${audio}${audio ? "\n      " : ""}${host}${out.slice(at)}`;
  }
  return null;
}

export async function applyCaptionsToProject(
  projectId: string,
  words: WordTiming[],
  options: CaptionRequest,
  audioRelPath?: string,
  audioSeconds?: number,
): Promise<{ captionsFile: string; duration: number }> {
  const root = projectPath(projectId);
  const meta = await readMeta(projectId);
  const portrait = meta.orientation === "portrait";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;

  const speechSeconds = (words.at(-1)?.end ?? 0) + 0.5;
  const indexFile = join(root, "index.html");
  const mounted = mountCaptions(await readFile(indexFile, "utf8"), { width, height, speechSeconds, audioSrc: audioRelPath, audioSeconds });
  if (!mounted) throw new Error("index.html has no root composition to attach captions to.");

  // Scene file and transcript first, index.html last: the preview must never see a host without its scene.
  await mkdir(join(root, "compositions"), { recursive: true });
  await mkdir(join(root, "assets"), { recursive: true });
  const scene = join(root, "compositions", "captions.html");
  await writeFile(`${scene}.part`, generateCaptionHtml(groupWords(words, options.wordsPerGroup), options, width, height));
  await rename(`${scene}.part`, scene);
  await writeFile(join(root, "assets", "transcript.json"), JSON.stringify({ words }, null, 2));
  await writeFile(`${indexFile}.part`, mounted);
  await rename(`${indexFile}.part`, indexFile);
  await touch(projectId);

  // The page we just wrote holds the final video length.
  const duration = setRootDuration(mounted, 1)?.before ?? speechSeconds;
  return { captionsFile: "compositions/captions.html", duration };
}
