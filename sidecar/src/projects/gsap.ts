import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../config.js";
import { downloadVerified } from "../audio/localTts.js";
import { projectPath } from "./store.js";

/**
 * Every HyperFrames project loads GSAP from a CDN, so a preview or a render with no internet shows nothing.
 * This keeps one verified copy in Memotion's data folder (downloaded once, from the same URL the projects use) and
 * points projects at their own copy of it, `assets/vendor/gsap.min.js`.
 *
 * GSAP is not part of this repository: its licence (https://gsap.com/standard-license) is the user's to accept when
 * they use it, exactly as when a browser fetches it from the CDN. Nothing is rewritten while no copy exists.
 */
export const GSAP_VERSION = "3.14.2";
const GSAP_URL = `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VERSION}/dist/gsap.min.js`;
export const GSAP_SHA256 = "c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280";
const LOCAL_SRC = "assets/vendor/gsap.min.js";

const cacheFile = (): string => join(dataDir(), "vendor", `gsap-${GSAP_VERSION}.min.js`);

/** The cached copy, downloading it once if needed. Null when there is none and the download failed (offline). */
export async function ensureGsapCache(signal?: AbortSignal): Promise<string | null> {
  const file = cacheFile();
  // Trust the cached copy only if it is the bytes we pinned: it ends up inside every project and every render.
  if (existsSync(file)) {
    if (createHash("sha256").update(await readFile(file)).digest("hex") === GSAP_SHA256) return file;
    await rm(file, { force: true });
  }
  // For tests and air-gapped machines: never reach for the network.
  if (process.env.MEMOTION_NO_VENDOR_DOWNLOAD === "1") return null;
  try {
    await downloadVerified(GSAP_URL, file, { sha256: GSAP_SHA256 }, 1_000_000, signal);
    return file;
  } catch {
    return null;
  }
}

/** The CDN tag for GSAP core, any 3.x: `https://cdn.jsdelivr.net/npm/gsap@3[.x.y]/dist/gsap.min.js`. Plugins are not matched. */
const CDN_TAG = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/gsap@3(?:\.\d+){0,2}\/dist\/gsap\.min\.js/g;

/** Rewrite the CDN address to the project-local file. Pure, so it can be checked without files. */
export function localizeHtml(html: string): string {
  return html.replace(CDN_TAG, LOCAL_SRC);
}

async function htmlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const index = join(root, "index.html");
  if (existsSync(index)) out.push(index);
  const dir = join(root, "compositions");
  if (existsSync(dir)) {
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith(".html")) out.push(join(entry.parentPath, entry.name));
    }
  }
  return out;
}

/**
 * Make the project load GSAP from its own folder. Returns the files that were changed. Does nothing (and
 * returns []) when there is no cached copy, so a project made while offline keeps working once online again.
 */
export async function localizeGsap(projectId: string, signal?: AbortSignal): Promise<string[]> {
  const root = projectPath(projectId);
  const files = await htmlFiles(root);
  const todo: { file: string; text: string }[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (localizeHtml(text) !== text) todo.push({ file, text });
  }
  if (todo.length === 0) return [];

  const cached = await ensureGsapCache(signal);
  if (!cached) return [];
  const target = join(root, LOCAL_SRC);
  await mkdir(join(target, ".."), { recursive: true });
  if (!existsSync(target)) await copyFile(cached, target);
  for (const t of todo) await writeFile(t.file, localizeHtml(t.text));
  return todo.map((t) => t.file.slice(root.length + 1));
}
