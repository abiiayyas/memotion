import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { runCli } from "../engine/cli.js";
import { parseJsonTail } from "../engine/tools.js";
import { getApiKey } from "../providers/store.js";
import { buildWhisperFromSource, ensureCpuWrapper, findWhisperBinary, needsCpuOnly } from "./whisperSetup.js";
import type { WordTiming } from "./types.js";

export interface Transcript {
  text: string;
  words: WordTiming[];
  duration: number;
}

/** Local transcription cannot run until whisper-cpp exists. Carries what the UI needs to ask for consent. */
export class LocalTranscriptionUnavailable extends Error {
  constructor() {
    super(
      "Local transcription is not set up. Either add an OpenAI API key (cloud Whisper), or allow Memotion to download whisper.cpp and build it in its own cache folder (a few minutes, nothing outside that folder is changed), then download a speech model.",
    );
    this.name = "LocalTranscriptionUnavailable";
  }
}

// ── pure parsing, shared by both engines ─────────────────────────────────────────────────

/** Entries that are not speech: music notes, replacement characters, bracketed sound tags. */
const NON_SPEECH = /^[♪♫�\s]+$|^\[[^\]]*\]$|^\([^)]*\)$/u;

/**
 * Whisper returns words; an imported SRT/VTT returns whole cues. Captions need words, so a multi-word entry is
 * split and its time is spread over the words by character count (the same fallback HyperFrames documents).
 */
export function normalizeTranscript(entries: { text: string; start: number; end: number }[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const e of entries) {
    const text = e.text.trim();
    if (text.length === 0 || NON_SPEECH.test(text) || e.end < e.start) continue;
    const parts = text.split(/\s+/);
    if (parts.length === 1) {
      out.push({ text, start: round3(e.start), end: round3(e.end) });
      continue;
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    let at = e.start;
    for (const p of parts) {
      const span = ((e.end - e.start) * p.length) / total;
      out.push({ text: p, start: round3(at), end: round3(at + span) });
      at += span;
    }
  }
  return out;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const CliOutput = z.union([
  z.looseObject({ ok: z.literal(true), transcriptPath: z.string() }),
  // Some failures carry `reason` (whisper_unavailable), others a human-readable `error`.
  z.looseObject({ ok: z.literal(false), reason: z.string().optional(), error: z.string().optional() }),
]);

const TranscriptFile = z.array(z.object({ text: z.string(), start: z.number(), end: z.number() }));

const WhisperVerbose = z.object({
  duration: z.number().optional(),
  text: z.string().optional(),
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
});

// ── engines ──────────────────────────────────────────────────────────────────────────────

async function transcribeOpenAi(filePath: string, apiKey: string, baseURL: string, language?: string): Promise<Transcript> {
  const form = new FormData();
  form.append("file", new Blob([await readFile(filePath)]), basename(filePath));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (language) form.append("language", language);

  const res = await fetch(`${baseURL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const parsed = WhisperVerbose.parse(await res.json());
  const words = normalizeTranscript((parsed.words ?? []).map((w) => ({ text: w.word, start: w.start, end: w.end })));
  if (words.length === 0) throw new Error("OpenAI returned no speech.");
  return { text: parsed.text ?? words.map((w) => w.text).join(" "), words, duration: parsed.duration ?? (words.at(-1)?.end ?? 0) + 0.1 };
}

/** Multilingual models for anything but explicit English; the `.en` ones translate other languages into English. */
export type WhisperModel = "base" | "small" | "medium" | "base.en" | "small.en" | "medium.en";

export function localModel(language: string | undefined, chosen: string | undefined): string {
  if (chosen) return chosen;
  return language === "en" ? "small.en" : "small";
}

/** The model the user picked in Settings, as a whisper model name. "auto" leaves the choice to `localModel`. */
export function preferredModel(pick: "auto" | "base" | "small" | "medium", language: string | undefined): WhisperModel | undefined {
  if (pick === "auto") return undefined;
  return language === "en" ? `${pick}.en` : pick;
}

/** At least one letter or digit in at least one word. A run of punctuation (",,") is whisper failing, not speech. */
export function hasSpeech(words: WordTiming[]): boolean {
  return words.some((w) => /[\p{L}\p{N}]/u.test(w.text));
}

/** Whisper produced output, but none of it is speech. Distinct from "no speech in the file". */
class GarbageTranscript extends Error {}

async function runLocalOnce(filePath: string, opts: { language?: string; model?: string }, env: NodeJS.ProcessEnv): Promise<Transcript> {
  // Output goes to a scratch directory so a failed or partial run never leaves files in the user's project.
  const scratch = await mkdtemp(join(tmpdir(), "memotion-stt-"));
  try {
    // Never let the CLI install anything itself: its first choice is `brew install whisper-cpp`, which builds a
    // large chain of dependencies and upgrades the user's packages. Memotion builds into the cache folder instead.
    const args = ["transcribe", filePath, "--dir", scratch, "--json", "--no-runtime-install"];
    if (opts.language) args.push("--language", opts.language);
    args.push("--model", localModel(opts.language, opts.model));

    const res = await runCli(args, { cwd: scratch, timeoutMs: 900_000, env });
    const parsed = CliOutput.safeParse(parseJsonTail(res.stdout) ?? parseJsonTail(res.stderr));
    if (!parsed.success) throw new Error(`Local transcription failed: ${(res.stderr || res.stdout).slice(-400) || `exit ${res.code}`}`);
    if (!parsed.data.ok) {
      if (parsed.data.reason === "whisper_unavailable") throw new LocalTranscriptionUnavailable();
      throw new Error(`Local transcription failed: ${parsed.data.error ?? parsed.data.reason ?? "unknown reason"}`);
    }
    const words = normalizeTranscript(TranscriptFile.parse(JSON.parse(await readFile(parsed.data.transcriptPath, "utf8"))));
    if (!hasSpeech(words)) throw new GarbageTranscript();
    return { text: words.map((w) => w.text).join(" "), words, duration: (words.at(-1)?.end ?? 0) + 0.1 };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function transcribeLocal(filePath: string, opts: { language?: string; model?: string; allowInstall: boolean }, signal?: AbortSignal): Promise<Transcript> {
  // An existing transcript (.srt, .vtt, .json) is imported, not transcribed: no whisper involved.
  if (/\.(srt|vtt|json)$/i.test(filePath)) return runLocalOnce(filePath, opts, {});

  let binary = findWhisperBinary();
  if (!binary) {
    if (!opts.allowInstall) throw new LocalTranscriptionUnavailable();
    binary = await buildWhisperFromSource(signal);
  }

  const useCpu = async (): Promise<NodeJS.ProcessEnv> => ({ HYPERFRAMES_WHISPER_PATH: await ensureCpuWrapper(binary ?? "") });
  const cpuFirst = needsCpuOnly();
  try {
    return await runLocalOnce(filePath, opts, cpuFirst ? await useCpu() : {});
  } catch (err) {
    // The first attempt used the GPU and heard nothing: try the CPU once before giving up.
    if (!(err instanceof GarbageTranscript) || cpuFirst) {
      if (err instanceof GarbageTranscript) throw new Error("No speech was found in this file.");
      throw err;
    }
    try {
      return await runLocalOnce(filePath, opts, await useCpu());
    } catch (retry) {
      if (retry instanceof GarbageTranscript) throw new Error("No speech was found in this file.");
      throw retry;
    }
  }
}

export interface TranscribeOptions {
  language?: string;
  /** Force an engine. Default: cloud Whisper if an OpenAI key exists, else local. */
  engine?: "openai" | "local";
  /** Whisper model for local transcription, e.g. `small` (multilingual) or `small.en`. */
  model?: string;
  /** Explicit user consent to let the CLI install whisper-cpp and download a model. */
  allowInstall?: boolean;
  /** Overrides the saved OpenAI key and endpoint; mainly for tests. */
  openAi?: { apiKey: string; baseURL: string };
}

/** Cloud Whisper when an OpenAI key exists (word timestamps, fast); otherwise local whisper.cpp via the CLI. */
export async function transcribeFile(filePath: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const apiKey = opts.engine === "local" ? undefined : (opts.openAi?.apiKey ?? getApiKey("openai") ?? process.env.OPENAI_API_KEY);
  if (apiKey) return transcribeOpenAi(filePath, apiKey, opts.openAi?.baseURL ?? "https://api.openai.com/v1", opts.language);
  return transcribeLocal(filePath, { language: opts.language, model: opts.model, allowInstall: opts.allowInstall === true });
}
