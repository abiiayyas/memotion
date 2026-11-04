import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "../config.js";
import { z } from "zod";
import { estimateByLength } from "./align.js";
import type { VoiceOption, WordTiming } from "./types.js";

/**
 * Offline speech with Piper voices, run by sherpa-onnx (Apache-2.0). The official Piper macOS build does not start
 * (it references libespeak-ng without shipping it — measured), while sherpa-onnx ships the same voices with its
 * phonemizer inside one native addon. Nothing here is installed until the user allows it.
 */
export const ENGINE_VERSION = "1.13.8";

/** npm package that holds the native addon for each platform. */
const ENGINE_PACKAGE: Record<string, string> = {
  "darwin-x64": "sherpa-onnx-darwin-x64",
  "darwin-arm64": "sherpa-onnx-darwin-arm64",
  "linux-x64": "sherpa-onnx-linux-x64",
  "linux-arm64": "sherpa-onnx-linux-arm64",
  "win32-x64": "sherpa-onnx-win-x64",
};

interface VoiceDef {
  name: string;
  locale: string;
  gender?: string;
  url: string;
  sha256: string;
  /** Folder inside the archive, and the model file in it. */
  folder: string;
  model: string;
  megabytes: number;
}

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

/** Hashes were measured on the downloaded files; a changed archive is refused. */
export const LOCAL_VOICES: Record<string, VoiceDef> = {
  "piper-id_ID-news_tts": {
    name: "News (Indonesian, offline)",
    locale: "id-ID",
    url: `${RELEASE}/vits-piper-id_ID-news_tts-medium-int8.tar.bz2`,
    sha256: "d7315f6bf6b61e75cc4397a934b3372fd7a8223bccb96ed817f7283649eebd89",
    folder: "vits-piper-id_ID-news_tts-medium-int8",
    model: "id_ID-news_tts-medium.onnx",
    megabytes: 21,
  },
  "piper-en_US-lessac": {
    name: "Lessac (US English, offline)",
    locale: "en-US",
    gender: "Female",
    url: `${RELEASE}/vits-piper-en_US-lessac-medium-int8.tar.bz2`,
    sha256: "f1c6d0295cf16087b05f80fdca5b44daca5cd78e2c425d419a42ba34929805f9",
    folder: "vits-piper-en_US-lessac-medium-int8",
    model: "en_US-lessac-medium.onnx",
    megabytes: 21,
  },
};

export const DEFAULT_LOCAL_VOICE = "piper-id_ID-news_tts";

export function localVoiceOptions(): VoiceOption[] {
  return Object.entries(LOCAL_VOICES).map(([id, v]) => ({ id, name: v.name, locale: v.locale, gender: v.gender, provider: "local" as const }));
}

/** The voice has not been downloaded yet. Carries what the UI needs to ask for consent. */
export class LocalTtsNotInstalled extends Error {
  readonly voice: string;
  constructor(voice: string) {
    super(
      `The offline voice is not downloaded yet. Allow Memotion to download the speech engine (about 37 MB) and the voice (about ${LOCAL_VOICES[voice]?.megabytes ?? 21} MB); after that it works without internet.`,
    );
    this.name = "LocalTtsNotInstalled";
    this.voice = voice;
  }
}

const root = (): string => join(dataDir(), "local-tts");
const engineDir = (): string => join(root(), "engine");
const voiceDir = (id: string): string => join(root(), "voices", id);
export const localVoiceDir = voiceDir;
export const localEngineDir = engineDir;

export function enginePackage(platform: string = process.platform, arch: string = process.arch): string | null {
  return ENGINE_PACKAGE[`${platform}-${arch}`] ?? null;
}

export interface LocalTtsStatus {
  supported: boolean;
  engine: boolean;
  voices: Record<string, boolean>;
}

export function localTtsStatus(): LocalTtsStatus {
  const pkg = enginePackage();
  const engine = pkg !== null && existsSync(join(engineDir(), "node_modules", pkg, "package.json")) && existsSync(join(engineDir(), "node_modules", "sherpa-onnx-node", "package.json"));
  const voices = Object.fromEntries(Object.entries(LOCAL_VOICES).map(([id, v]) => [id, existsSync(join(voiceDir(id), v.folder, v.model))]));
  return { supported: pkg !== null, engine, voices };
}

// ── download, verify, unpack ─────────────────────────────────────────────────────────────

export interface Expect {
  /** Hex digest. */
  sha256?: string;
  /** npm's `dist.integrity` style: "sha512-<base64>". */
  integrity?: string;
}

/** Stream a URL to a file, refusing anything over `maxBytes` or not matching the expected digest. */
export async function downloadVerified(url: string, dest: string, expect: Expect, maxBytes: number, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${new URL(url).host}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`Download is larger than expected (${declared} bytes).`);

  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  const part = `${dest}.part`;
  await mkdir(join(dest, ".."), { recursive: true });
  const out = createWriteStream(part);
  let size = 0;
  try {
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error(`Download is larger than expected (over ${maxBytes} bytes).`);
      sha256.update(chunk);
      sha512.update(chunk);
      if (!out.write(chunk)) {
        const drained = Promise.withResolvers<void>();
        out.once("drain", () => drained.resolve());
        await drained.promise;
      }
    }
    const closed = Promise.withResolvers<void>();
    out.once("error", closed.reject);
    out.end(() => closed.resolve());
    await closed.promise;

    if (expect.sha256 && sha256.digest("hex") !== expect.sha256) throw new Error("The downloaded file does not match its published checksum; it was discarded.");
    if (expect.integrity) {
      const [algo, b64] = expect.integrity.split("-", 2);
      if (algo !== "sha512" || sha512.digest("base64") !== b64) throw new Error("The downloaded package does not match its published checksum; it was discarded.");
    }
    await rename(part, dest);
  } catch (err) {
    out.destroy();
    await rm(part, { force: true });
    throw err;
  }
}

function run(cmd: string, args: string[], timeout: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  execFile(cmd, args, { timeout, maxBuffer: 4_000_000 }, (err, _out, stderr) => {
    if (err) reject(new Error(`${cmd} failed: ${(stderr || err.message).toString().slice(-300)}`));
    else resolve();
  });
  return promise;
}

const NpmVersion = z.object({ dist: z.object({ tarball: z.url(), integrity: z.string() }) });

async function installPackage(name: string, into: string, signal?: AbortSignal): Promise<void> {
  const meta = NpmVersion.parse(await (await fetch(`https://registry.npmjs.org/${name}/${ENGINE_VERSION}`, { signal })).json());
  const scratch = join(tmpdir(), `memotion-npm-${process.pid}-${name}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const tgz = join(scratch, "pkg.tgz");
    await downloadVerified(meta.dist.tarball, tgz, { integrity: meta.dist.integrity }, 120_000_000, signal);
    const target = join(into, name);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    // npm tarballs keep everything under a top-level "package/" folder.
    await run("tar", ["-xzf", tgz, "-C", target, "--strip-components=1"], 120_000);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

const installing: Record<string, Promise<void> | undefined> = {};

/** Download the speech engine (once) and one voice. Safe to call twice at the same time. */
export function installLocalTts(voiceId: string, signal?: AbortSignal): Promise<void> {
  const voice = LOCAL_VOICES[voiceId];
  if (!voice) return Promise.reject(new Error(`Unknown offline voice "${voiceId}".`));
  const pkg = enginePackage();
  if (!pkg) return Promise.reject(new Error(`Offline voices are not available for ${process.platform}-${process.arch} yet.`));

  const running = installing[voiceId];
  if (running) return running;
  const job = (async () => {
    const status = localTtsStatus();
    if (!status.engine) {
      const modules = join(engineDir(), "node_modules");
      await mkdir(modules, { recursive: true });
      await installPackage("sherpa-onnx-node", modules, signal);
      await installPackage(pkg, modules, signal);
    }
    if (!status.voices[voiceId]) {
      const dir = voiceDir(voiceId);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const archive = join(dir, "voice.tar.bz2");
      await downloadVerified(voice.url, archive, { sha256: voice.sha256 }, 120_000_000, signal);
      await run("tar", ["-xjf", archive, "-C", dir], 120_000);
      await rm(archive, { force: true });
      if (!existsSync(join(dir, voice.folder, voice.model))) {
        await rm(dir, { recursive: true, force: true });
        throw new Error("The voice archive did not contain the expected model.");
      }
    }
  })().finally(() => {
    installing[voiceId] = undefined;
  });
  installing[voiceId] = job;
  return job;
}

// ── synthesis ────────────────────────────────────────────────────────────────────────────

/**
 * Runs in a child `node -e`, so a long synthesis never blocks the sidecar and a native crash cannot take it down.
 * Reads the job from MEMOTION_TTS_JOB, writes a WAV, prints one JSON line with the speech span (leading and
 * trailing silence trimmed from the timing, not from the audio).
 */
const WORKER = `
const { createRequire } = require("node:module");
const job = JSON.parse(process.env.MEMOTION_TTS_JOB);
const sherpa = createRequire(job.engineDir + "/")("sherpa-onnx-node");
const tts = new sherpa.OfflineTts({
  model: { vits: { model: job.model, tokens: job.tokens, dataDir: job.dataDir }, numThreads: job.threads, provider: "cpu" },
  maxNumSentences: 1,
});
const audio = tts.generate({ text: job.text, sid: 0, speed: job.speed });
const s = audio.samples;
let a = 0; while (a < s.length && Math.abs(s[a]) < 0.01) a++;
let b = s.length - 1; while (b > a && Math.abs(s[b]) < 0.01) b--;
sherpa.writeWave(job.out, { samples: s, sampleRate: audio.sampleRate });
const rate = audio.sampleRate;
process.stdout.write("\\n" + JSON.stringify({ duration: s.length / rate, speechStart: Math.max(0, a / rate - 0.03), speechEnd: Math.min(s.length / rate, (b + 1) / rate + 0.03) }) + "\\n");
`;

const WorkerResult = z.object({ duration: z.number(), speechStart: z.number(), speechEnd: z.number() });

export interface LocalSpeech {
  wavPath: string;
  duration: number;
  words: WordTiming[];
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Synthesize `text` to a WAV file at `outWav`. Word times are estimated from length inside the measured speech span. */
export async function synthesizeLocal(text: string, voiceId: string, rate: number, outWav: string, signal?: AbortSignal): Promise<LocalSpeech> {
  const voice = LOCAL_VOICES[voiceId];
  if (!voice) throw new Error(`Unknown offline voice "${voiceId}".`);
  const status = localTtsStatus();
  if (!status.engine || !status.voices[voiceId]) throw new LocalTtsNotInstalled(voiceId);

  const dir = join(voiceDir(voiceId), voice.folder);
  const job = {
    engineDir: engineDir(),
    model: join(dir, voice.model),
    tokens: join(dir, "tokens.txt"),
    dataDir: join(dir, "espeak-ng-data"),
    threads: Math.max(1, Math.min(4, cpus().length - 1)),
    text,
    speed: rate,
    out: outWav,
  };
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    process.execPath,
    ["-e", WORKER],
    { env: { ...process.env, MEMOTION_TTS_JOB: JSON.stringify(job) }, timeout: 900_000, signal, maxBuffer: 1_000_000 },
    (err, stdout, stderr) => {
      if (err) reject(new Error(`Offline speech failed: ${(stderr || err.message).toString().slice(-400)}`));
      else resolve(stdout);
    },
  );
  const lastLine = (await promise).trim().split("\n").at(-1) ?? "";
  const measured = WorkerResult.parse(JSON.parse(lastLine));

  const spoken = estimateByLength(splitWords(text), Math.max(0.1, measured.speechEnd - measured.speechStart), 0);
  const words = spoken.map((w) => ({ ...w, start: round3(w.start + measured.speechStart), end: round3(w.end + measured.speechStart) }));
  return { wavPath: outWav, duration: measured.duration, words };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// ── wav → mp3 (the voiceover is always assets/audio/voiceover.mp3) ───────────────────────

export function findFfmpeg(): string | null {
  const candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  try {
    return execFileSync("sh", ["-c", "command -v ffmpeg"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** `tempo` speeds the speech up or down (ffmpeg `atempo`, 0.5–2) without changing its pitch. */
export async function wavToMp3(wav: string, mp3: string, tempo = 1): Promise<void> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg is needed to turn the offline voice into an mp3 (it is also needed to render videos). Install it, for example with: brew install ffmpeg");
  const filter = tempo === 1 ? [] : ["-filter:a", `atempo=${tempo}`];
  await run(ffmpeg, ["-y", "-loglevel", "error", "-i", wav, ...filter, "-codec:a", "libmp3lame", "-q:a", "3", mp3], 120_000);
}
