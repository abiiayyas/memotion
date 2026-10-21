import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../config.js";

export interface Format {
  id: string;
  name: string;
  description: string;
  /** Markdown the director follows. */
  body: string;
  builtIn: boolean;
  /** Suggested canvas; only a hint for the "new video" form. */
  orientation?: "landscape" | "portrait";
}

const MAX_BODY = 6000;

const BUILT_IN: Format[] = [
  {
    id: "course-module",
    name: "Course module (16:9)",
    description: "A lesson of 2-8 minutes: objectives, three key points, recap.",
    orientation: "landscape",
    builtIn: true,
    body: `Structure the video as a lesson:
1. Title card (3 s): the lesson name and a number ("Module 2").
2. "What you will learn" (5-8 s): at most three short bullets that appear one by one.
3. One scene per key point (at most three). Each has a heading, one supporting visual or diagram built in HTML/CSS, and at most 12 words on screen at once.
4. Recap (5-8 s): the three points again, shortened to a few words each.
5. Closing card (3 s): what to do next.
Pace for learning, not for attention: hold each key point 8-20 s; a new idea never appears while the previous one is still animating in. Narrate with generate_voiceover and add captions; if no script is given, write one that explains each point in plain spoken sentences. Keep type at least 48 px.`,
  },
  {
    id: "short-hook",
    name: "Short / Reel with captions (9:16)",
    description: "15-45 s vertical video: a hook in two seconds, one idea, word-by-word captions.",
    orientation: "portrait",
    builtIn: true,
    body: `Structure the video for a phone feed:
1. Hook in the first 2 s: the boldest line or number, large, already on screen at frame 0 (no fade-in from empty).
2. One idea only. Change the picture or the layout every 2-3 s so the eye keeps moving.
3. End on a short call to action (follow, save, visit) held for 2 s.
Captions are required: call generate_voiceover with captionStyle "highlight" or "pop" and put key visuals above the caption band (the bottom 20% of the screen is covered by app UI). Keep headline type at least 90 px. Total length 15-45 s.`,
  },
  {
    id: "product-promo",
    name: "Product promo (16:9 or 9:16)",
    description: "20-40 s: problem, product, proof, call to action.",
    builtIn: true,
    body: `Structure the video as four beats of roughly equal length:
1. Problem: one line the viewer recognises, on a plain background.
2. Product: its name and logo large, with the single benefit that fixes the problem.
3. Proof: a number, a short quote, or a screenshot from the captured website if one exists in assets/capture.
4. Call to action: one action and where to do it.
Use the brand's colours and logo. One focal point per beat; avoid more than 10 words per beat.`,
  },
];

function userDir(): string {
  return join(dataDir(), "formats");
}

/** `---\nname: …\ndescription: …\norientation: portrait\n---\n<markdown>` */
export function parseFormat(id: string, raw: string): Format | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const head: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (kv?.[1]) head[kv[1].toLowerCase()] = (kv[2] ?? "").trim();
  }
  const body = (m ? (m[2] ?? "") : raw).trim();
  if (body.length === 0) return null;
  const orientation = head.orientation === "portrait" || head.orientation === "landscape" ? head.orientation : undefined;
  return { id, name: head.name || id, description: head.description ?? "", body: body.slice(0, MAX_BODY), builtIn: false, orientation };
}

export async function listFormats(): Promise<Format[]> {
  await mkdir(userDir(), { recursive: true });
  const custom: Format[] = [];
  for (const file of await readdir(userDir())) {
    if (!file.endsWith(".md")) continue;
    const id = file.slice(0, -3).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const f = parseFormat(id, await readFile(join(userDir(), file), "utf8"));
    if (f && !BUILT_IN.some((b) => b.id === id)) custom.push(f);
  }
  return [...BUILT_IN, ...custom];
}

export async function getFormat(id: string): Promise<Format | null> {
  return (await listFormats()).find((f) => f.id === id) ?? null;
}

export function formatsDir(): string {
  return userDir();
}
