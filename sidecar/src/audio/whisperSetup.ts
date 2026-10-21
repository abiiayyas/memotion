import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir } from "../config.js";

/** Where the HyperFrames CLI itself looks for a whisper.cpp it built, so both find the same binary. */
const CACHE_DIR = join(homedir(), ".cache", "hyperframes", "whisper");
const SOURCE_DIR = join(CACHE_DIR, "whisper.cpp");
const REPO = "https://github.com/ggml-org/whisper.cpp.git";

/** Where the CLI keeps a downloaded model. Checking this lets callers use whisper without triggering a download. */
export function whisperModelPath(model: string): string {
  return join(CACHE_DIR, "models", `ggml-${model}.bin`);
}

function onPath(name: string): string | null {
  try {
    const out = execFileSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** The whisper.cpp command-line tool, wherever it is: an override, the PATH, Homebrew, or our own build. */
export function findWhisperBinary(): string | null {
  const candidates = [
    process.env.HYPERFRAMES_WHISPER_PATH,
    onPath("whisper-cli"),
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
    join(SOURCE_DIR, "build", "bin", "whisper-cli"),
    join(SOURCE_DIR, "build", "whisper-cli"),
  ];
  return candidates.find((p): p is string => typeof p === "string" && p.length > 0 && existsSync(p)) ?? null;
}

/**
 * On Intel Macs whisper.cpp's Metal (GPU) backend returns garbage — measured here: a clear 7-second Indonesian
 * sentence came back as a single "," — while the CPU backend transcribes it correctly. `-ng` turns the GPU off.
 */
export function needsCpuOnly(platform: string = process.platform, arch: string = process.arch): boolean {
  return platform === "darwin" && arch === "x64";
}

export function cpuWrapperScript(realBinary: string): string {
  // Single-quote the path for sh; a quote inside it is closed, escaped and reopened.
  const quoted = `'${realBinary.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\nexec ${quoted} -ng "$@"\n`;
}

/** A tiny launcher that adds `-ng`, for the CLI to use through HYPERFRAMES_WHISPER_PATH. */
export async function ensureCpuWrapper(realBinary: string): Promise<string> {
  const dir = join(dataDir(), "bin");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "whisper-cpu");
  await writeFile(file, cpuWrapperScript(realBinary));
  await chmod(file, 0o755);
  return file;
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeout: number; signal?: AbortSignal }): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout, signal: opts.signal, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 8_000_000 }, (err, _out, stderr) => {
    if (err) reject(new Error(`${cmd} ${args[0] ?? ""} failed: ${(stderr || err.message).toString().slice(-400)}`));
    else resolve();
  });
  return promise;
}

export interface Missing {
  tool: string;
  hint: string;
}

/** Tools the build needs. Reported by name so the user knows what to install, instead of an opaque failure. */
export function missingBuildTools(): Missing[] {
  const need: Missing[] = [];
  if (!onPath("git")) need.push({ tool: "git", hint: "xcode-select --install" });
  if (!onPath("cmake")) need.push({ tool: "cmake", hint: "brew install cmake" });
  if (!onPath("cc") && !onPath("clang")) need.push({ tool: "a C compiler", hint: "xcode-select --install" });
  return need;
}

/**
 * Build whisper.cpp from source inside the user's cache folder. Nothing outside that folder is touched
 * (unlike `brew install whisper-cpp`, which pulled in a chain of build dependencies and upgraded packages).
 */
export async function buildWhisperFromSource(signal?: AbortSignal): Promise<string> {
  const missing = missingBuildTools();
  if (missing.length > 0) {
    throw new Error(`Cannot build whisper.cpp: missing ${missing.map((m) => `${m.tool} (${m.hint})`).join(", ")}.`);
  }
  await mkdir(CACHE_DIR, { recursive: true });
  if (!existsSync(SOURCE_DIR)) await run("git", ["clone", "--depth", "1", REPO, SOURCE_DIR], { timeout: 120_000, signal });
  await run("cmake", ["-B", "build"], { cwd: SOURCE_DIR, timeout: 180_000, signal });
  await run("cmake", ["--build", "build", "--config", "Release", "-j"], { cwd: SOURCE_DIR, timeout: 900_000, signal });
  const built = findWhisperBinary();
  if (!built) throw new Error("The build finished but whisper-cli was not found.");
  return built;
}
