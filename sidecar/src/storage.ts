import { existsSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_VOICES, localEngineDir, localVoiceDir } from "./audio/localTts.js";
import { whisperBuildDir, whisperModelsDir } from "./audio/whisperSetup.js";
import { projectsDir } from "./config.js";
import { gsapCacheFile } from "./projects/gsap.js";

export interface StorageItem {
  /** What a removal request names. Never a path: the server maps it to a fixed location. */
  id: string;
  label: string;
  /** One line on what it is for and what removing it costs. */
  note: string;
  bytes: number;
}

/** Bytes under a path, links counted as themselves and never followed. Missing paths are 0. */
export async function sizeOf(path: string): Promise<number> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map((name) => sizeOf(join(path, name))));
  return sizes.reduce((a, b) => a + b, 0);
}

const WHISPER_FILE = /^ggml-([a-z0-9.-]+)\.bin$/;

async function whisperModels(): Promise<{ id: string; model: string; path: string }[]> {
  const dir = whisperModelsDir();
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.flatMap((name) => {
    const m = WHISPER_FILE.exec(name);
    return m?.[1] ? [{ id: `whisper-model:${m[1]}`, model: m[1], path: join(dir, name) }] : [];
  });
}

/** Where each removable item lives. Computed from fixed tables and directory listings, so a request cannot reach anything else. */
async function locations(): Promise<{ id: string; label: string; note: string; path: string }[]> {
  const voices = Object.entries(LOCAL_VOICES).flatMap(([id, v]) =>
    existsSync(localVoiceDir(id)) ? [{ id: `voice:${id}`, label: v.name, note: `Offline voice. Removing it means downloading it again (about ${v.megabytes} MB) before it can speak.`, path: localVoiceDir(id) }] : [],
  );
  const models = (await whisperModels()).map((m) => ({
    id: m.id,
    label: `Whisper model “${m.model}”`,
    note: "Used to turn speech into captions on this computer. Removing it means downloading it again the next time.",
    path: m.path,
  }));
  return [
    ...voices,
    { id: "tts-engine", label: "Offline voice engine", note: "The program that speaks the offline voices. Without it no offline voice works, even if the voice files stay.", path: localEngineDir() },
    ...models,
    { id: "whisper-build", label: "whisper.cpp build", note: "Built by Memotion when you allowed it. Removing it means building it again (minutes).", path: whisperBuildDir() },
    { id: "gsap", label: "GSAP copy", note: "The animation library kept so every video can work offline. Projects already hold their own copy; removing this only affects projects made later.", path: gsapCacheFile() },
  ];
}

/** Everything Memotion keeps that is not a project, with its size. Items that are not on disk are left out. */
export async function listStorage(): Promise<{ items: StorageItem[]; projectsBytes: number; rendersBytes: number }> {
  const found = await locations();
  const items = (
    await Promise.all(found.map(async (f): Promise<StorageItem> => ({ id: f.id, label: f.label, note: f.note, bytes: await sizeOf(f.path) })))
  ).filter((i) => i.bytes > 0);

  const root = projectsDir();
  const projectDirs = existsSync(root) ? await readdir(root) : [];
  const [projectsBytes, renders] = await Promise.all([sizeOf(root), Promise.all(projectDirs.map((d) => sizeOf(join(root, d, "renders"))))]);
  return { items, projectsBytes, rendersBytes: renders.reduce((a, b) => a + b, 0) };
}

/** Delete one listed item. Returns false when the id is not one of the items present. */
export async function removeStorage(id: string): Promise<boolean> {
  const target = (await locations()).find((l) => l.id === id);
  if (!target) return false;
  await rm(target.path, { recursive: true, force: true });
  return true;
}
