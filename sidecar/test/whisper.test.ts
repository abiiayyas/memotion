import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliOptions, CliResult } from "../src/engine/cli.js";

const dir = mkdtempSync(join(tmpdir(), "memotion-whisper-"));
process.env.MEMOTION_DATA_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The tests below decide *what Memotion does* in each situation, so the two things that vary by machine
// (is whisper installed? is this an Intel Mac?) and the CLI itself are replaced.
const state = {
  binary: null as string | null,
  cpuOnly: false,
  built: 0,
  calls: [] as { args: string[]; whisperPath: string | undefined }[],
  /** One transcript per CLI call, in order. */
  transcripts: [] as { text: string; start: number; end: number }[][],
};

vi.mock("../src/audio/whisperSetup.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/audio/whisperSetup.js")>();
  return {
    ...real,
    findWhisperBinary: () => state.binary,
    needsCpuOnly: () => state.cpuOnly,
    buildWhisperFromSource: async () => {
      state.built++;
      state.binary = "/fake/build/whisper-cli";
      return state.binary;
    },
  };
});

vi.mock("../src/engine/cli.js", () => ({
  runCli: async (args: string[], opts: CliOptions): Promise<CliResult> => {
    state.calls.push({ args, whisperPath: opts.env?.HYPERFRAMES_WHISPER_PATH });
    const out = join(opts.cwd, `transcript-${state.calls.length}.json`);
    writeFileSync(out, JSON.stringify(state.transcripts.shift() ?? []));
    return { code: 0, stdout: JSON.stringify({ ok: true, transcriptPath: out }), stderr: "" };
  },
}));

const { transcribeFile, LocalTranscriptionUnavailable, hasSpeech, localModel } = await import("../src/audio/transcribe.js");
const { cpuWrapperScript, needsCpuOnly: realNeedsCpuOnly } = await vi.importActual<typeof import("../src/audio/whisperSetup.js")>("../src/audio/whisperSetup.js");

const SPEECH = [{ text: "Selamat", start: 0.1, end: 0.6 }, { text: "datang", start: 0.6, end: 1.1 }];
const GARBAGE = [{ text: ",,", start: 0, end: 30 }];
const audio = join(dir, "talk.mp3");
writeFileSync(audio, Buffer.alloc(64));

beforeEach(() => {
  Object.assign(state, { binary: "/fake/whisper-cli", cpuOnly: false, built: 0, calls: [], transcripts: [] });
});

describe("what counts as speech", () => {
  it("rejects punctuation-only output, which is how a broken backend shows itself", () => {
    expect(hasSpeech([{ text: ",,", start: 0, end: 30 }])).toBe(false);
    expect(hasSpeech([{ text: "…", start: 0, end: 1 }, { text: "-", start: 1, end: 2 }])).toBe(false);
    expect(hasSpeech([])).toBe(false);
    expect(hasSpeech([{ text: ",", start: 0, end: 1 }, { text: "ya", start: 1, end: 2 }])).toBe(true);
    expect(hasSpeech([{ text: "2026", start: 0, end: 1 }])).toBe(true);
    expect(hasSpeech([{ text: "你好", start: 0, end: 1 }])).toBe(true);
  });
});

describe("model choice", () => {
  it("uses a multilingual model unless English is requested, because the .en models translate other languages into English", () => {
    expect(localModel(undefined, undefined)).toBe("small");
    expect(localModel("id", undefined)).toBe("small");
    expect(localModel("en", undefined)).toBe("small.en");
    expect(localModel("en", "medium")).toBe("medium");
  });
});

describe("local transcription flow", () => {
  it("does not install anything without consent, and never asks the CLI to install", async () => {
    state.binary = null;
    await expect(transcribeFile(audio, { engine: "local" })).rejects.toBeInstanceOf(LocalTranscriptionUnavailable);
    expect(state.built).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it("builds whisper itself when the user consents, then transcribes with --no-runtime-install", async () => {
    state.binary = null;
    state.transcripts = [SPEECH];
    const t = await transcribeFile(audio, { engine: "local", allowInstall: true, language: "id" });
    expect(state.built).toBe(1);
    expect(t.words.map((w) => w.text)).toEqual(["Selamat", "datang"]);
    const args = state.calls[0]!.args;
    expect(args).toContain("--no-runtime-install");
    expect(args).toEqual(expect.arrayContaining(["--model", "small", "--language", "id"]));
  });

  it("on a machine where the GPU backend fails, retries once on the CPU and returns that result", async () => {
    state.transcripts = [GARBAGE, SPEECH];
    const t = await transcribeFile(audio, { engine: "local" });
    expect(t.words).toHaveLength(2);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]!.whisperPath).toBeUndefined();
    expect(state.calls[1]!.whisperPath).toMatch(/whisper-cpu$/);
  });

  it("goes straight to the CPU where the GPU is known to be broken (Intel Macs), with no wasted first attempt", async () => {
    state.cpuOnly = true;
    state.transcripts = [SPEECH];
    await transcribeFile(audio, { engine: "local" });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]!.whisperPath).toMatch(/whisper-cpu$/);
  });

  it("gives up with a plain message after the CPU attempt also hears nothing", async () => {
    state.transcripts = [GARBAGE, GARBAGE];
    await expect(transcribeFile(audio, { engine: "local" })).rejects.toThrow("No speech was found in this file.");
    expect(state.calls).toHaveLength(2);

    state.calls = [];
    state.cpuOnly = true;
    state.transcripts = [GARBAGE];
    await expect(transcribeFile(audio, { engine: "local" })).rejects.toThrow("No speech was found in this file.");
    expect(state.calls).toHaveLength(1); // already on the CPU: nothing left to retry
  });

  it("imports a transcript file without needing whisper at all", async () => {
    state.binary = null;
    state.transcripts = [SPEECH];
    const t = await transcribeFile(join(dir, "talk.srt"), { engine: "local" });
    expect(t.words).toHaveLength(2);
    expect(state.built).toBe(0);
  });
});

describe("CPU launcher", () => {
  it("is a script that runs the real binary with -ng and passes every argument through", () => {
    const script = cpuWrapperScript("/opt/a b/whisper-cli");
    expect(script).toBe(`#!/bin/sh\nexec '/opt/a b/whisper-cli' -ng "$@"\n`);
  });

  it("survives a quote in the path", () => {
    expect(cpuWrapperScript("/o'dd/whisper-cli")).toContain(`exec '/o'\\''dd/whisper-cli' -ng`);
  });

  it("really executes: flags arrive after -ng, in order, with spaces intact", async () => {
    const { execFileSync } = await import("node:child_process");
    const fake = join(dir, "fake whisper");
    writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do echo "[$a]"; done\n', { mode: 0o755 });
    const wrapper = join(dir, "wrap.sh");
    writeFileSync(wrapper, cpuWrapperScript(fake), { mode: 0o755 });
    expect(statSync(wrapper).mode & 0o111).not.toBe(0);
    expect(execFileSync(wrapper, ["-m", "a model.bin", "-f", "x.wav"], { encoding: "utf8" })).toBe("[-ng]\n[-m]\n[a model.bin]\n[-f]\n[x.wav]\n");
  });

  it("is only used on Intel Macs", () => {
    expect(realNeedsCpuOnly("darwin", "x64")).toBe(true);
    expect(realNeedsCpuOnly("darwin", "arm64")).toBe(false);
    expect(realNeedsCpuOnly("linux", "x64")).toBe(false);
    mkdirSync(dir, { recursive: true });
    expect(readFileSync(audio).length).toBe(64);
  });
});
