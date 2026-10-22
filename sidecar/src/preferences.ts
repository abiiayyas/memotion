import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataDir } from "./config.js";

/**
 * Choices the user makes in Settings that are not secrets and not providers. They live in their own file so the
 * provider config (which holds the model choice and keychain ids) keeps one job. Every key has a default, so a
 * missing or older file just means "as shipped".
 */
const Shape = z.object({
  /** Language the director writes its chat messages in. On-screen text still follows the user's prompt. */
  replyLanguage: z.enum(["auto", "id", "en"]),
  /** Most model rounds (a round is one model call plus its tool calls) the director gets per request. */
  maxSteps: z.number().int().min(10).max(120),
  /** Most frame reviews per request, 0 turns the reviewer off. */
  maxReviews: z.number().int().min(0).max(6),
  /** Most generated images per request, 0 stops the director from making any. */
  maxImages: z.number().int().min(0).max(10),
  newVideoOrientation: z.enum(["landscape", "portrait"]),
  newVideoFps: z.union([z.literal(30), z.literal(60)]),
  exportQuality: z.enum(["draft", "standard", "high"]),
  /** "project" renders at the project's own rate. */
  exportFps: z.enum(["project", "30", "60"]),
  /** Speech-to-text model; "auto" is small, with the English-only variant for English. */
  whisperModel: z.enum(["auto", "base", "small", "medium"]),
  voiceVendor: z.enum(["edge", "local", "openai", "elevenlabs"]),
  voiceId: z.string().min(1).max(120),
  voiceRate: z.number().min(0.5).max(2),
  captionsOn: z.boolean(),
  captionStyle: z.enum(["classic", "highlight", "pop", "clean"]),
  captionPosition: z.enum(["bottom", "center", "top"]),
});

export type Preferences = z.infer<typeof Shape>;

export const DEFAULT_PREFERENCES: Preferences = {
  replyLanguage: "auto",
  maxSteps: 60,
  maxReviews: 3,
  maxImages: 4,
  newVideoOrientation: "landscape",
  newVideoFps: 30,
  exportQuality: "standard",
  exportFps: "project",
  whisperModel: "auto",
  voiceVendor: "edge",
  voiceId: "id-ID-GadisNeural",
  voiceRate: 1,
  captionsOn: true,
  captionStyle: "highlight",
  captionPosition: "bottom",
};

/** What a request may change: any subset, each value checked. Unknown keys are refused, not dropped. */
export const PreferencesPatch = z.strictObject(Shape.partial().shape);

const file = (): string => join(dataDir(), "preferences.json");

export function getPreferences(): Preferences {
  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    return DEFAULT_PREFERENCES;
  }
  // A file with one bad value (hand-edited, or written by a newer version) falls back to defaults as a whole.
  const parsed = Shape.partial().safeParse(raw);
  return parsed.success ? { ...DEFAULT_PREFERENCES, ...parsed.data } : DEFAULT_PREFERENCES;
}

export function updatePreferences(patch: z.infer<typeof PreferencesPatch>): Preferences {
  const next = { ...getPreferences(), ...patch };
  mkdirSync(dataDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, file());
  return next;
}

export function resetPreferences(): Preferences {
  return updatePreferences(DEFAULT_PREFERENCES);
}
