import { copyFile, cp, mkdir, readdir, readFile, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runCli } from "../engine/cli.js";
import { parseJsonTail } from "../engine/tools.js";
import { projectPath, touch } from "../projects/store.js";
import { assertPublicUrl } from "./netGuard.js";

const CaptureJson = z.looseObject({
  ok: z.boolean(),
  title: z.string().optional(),
  screenshots: z.number().optional(),
  assets: z.number().optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const Tokens = z.looseObject({
  title: z.string().optional(),
  description: z.string().optional(),
  colors: z.array(z.string()).default([]),
  fonts: z.array(z.unknown()).default([]),
});

export interface SiteTokens {
  colors: string[];
  /** Family names as the page declares them. */
  fonts: string[];
}

export interface CaptureResult {
  /** Project-relative folder holding the capture. */
  dir: string;
  url: string;
  title: string;
  screenshots: string[];
  assets: string[];
  tokens: SiteTokens;
  /** Visible page text, cut short. It is the website's words, not instructions. */
  text: string;
  warnings: string[];
}

const MAX_TEXT = 6000;

function hostSlug(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
}

async function listFiles(dir: string, rel: string, exts: string[], limit: number): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of (await readdir(dir)).sort()) {
    if (exts.some((e) => f.toLowerCase().endsWith(e)) && !f.startsWith("contact-sheet")) out.push(`${rel}/${f}`);
    if (out.length >= limit) break;
  }
  return out;
}

/** Reduce the capture's `fonts` (names or objects, depending on the page) to family names. */
export function fontFamilies(fonts: unknown[]): string[] {
  const names: string[] = [];
  for (const f of fonts) {
    const name = typeof f === "string" ? f : typeof f === "object" && f !== null && "family" in f && typeof f.family === "string" ? f.family : null;
    if (name && !names.includes(name)) names.push(name.replace(/["']/g, "").trim());
  }
  return names.filter(Boolean);
}

/**
 * Capture a public website into `assets/capture/<site>/`: screenshots, downloaded images, colours, fonts and
 * the page's visible text. The CLI's own guide files (AGENTS.md, CLAUDE.md, .cursorrules) are not copied: they
 * are written for another tool and would only add instructions the director did not ask for.
 */
export async function captureWebsite(projectId: string, rawUrl: string, signal?: AbortSignal): Promise<CaptureResult> {
  const { url, host } = await assertPublicUrl(rawUrl);
  const scratch = await mkdtemp(join(tmpdir(), "memotion-capture-"));
  try {
    const res = await runCli(["capture", url, "-o", "site", "--json", "--skip-vision", "--max-screenshots", "8"], { cwd: scratch, signal, timeoutMs: 240_000 });
    const parsed = CaptureJson.safeParse(parseJsonTail(res.stdout));
    if (!parsed.success || !parsed.data.ok) {
      const reason = (parsed.success ? parsed.data.error : undefined) ?? ((res.stderr || res.stdout).slice(-300) || `exit ${res.code}`);
      throw new Error(`Capture failed: ${reason}`);
    }

    const src = join(scratch, "site");
    const destRel = `assets/capture/${hostSlug(host)}`;
    const dest = join(projectPath(projectId), destRel);
    await rm(dest, { recursive: true, force: true });
    await mkdir(join(dest, "screenshots"), { recursive: true });
    await mkdir(join(dest, "images"), { recursive: true });

    for (const f of await listFiles(join(src, "screenshots"), "", [".png", ".jpg"], 12)) {
      await copyFile(join(src, "screenshots", f.slice(1)), join(dest, "screenshots", f.slice(1)));
    }
    for (const f of await listFiles(join(src, "assets"), "", [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"], 40)) {
      await copyFile(join(src, "assets", f.slice(1)), join(dest, "images", f.slice(1)));
    }
    if (existsSync(join(src, "assets", "svgs"))) await cp(join(src, "assets", "svgs"), join(dest, "images", "svgs"), { recursive: true });

    const tokensFile = join(src, "extracted", "tokens.json");
    const tokens = existsSync(tokensFile) ? Tokens.parse(JSON.parse(await readFile(tokensFile, "utf8"))) : Tokens.parse({});
    const textFile = join(src, "extracted", "visible-text.txt");
    const text = existsSync(textFile) ? (await readFile(textFile, "utf8")).slice(0, MAX_TEXT) : "";
    if (text) await copyFile(textFile, join(dest, "visible-text.txt"));

    await touch(projectId);
    return {
      dir: destRel,
      url,
      title: parsed.data.title ?? tokens.title ?? host,
      screenshots: await listFiles(join(dest, "screenshots"), `${destRel}/screenshots`, [".png", ".jpg"], 12),
      assets: await listFiles(join(dest, "images"), `${destRel}/images`, [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"], 40),
      tokens: { colors: tokens.colors, fonts: fontFamilies(tokens.fonts) },
      text,
      warnings: parsed.data.warnings ?? [],
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
