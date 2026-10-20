import { mkdir, readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { join } from "node:path";
import { runCli } from "./cli.js";
import { projectPath } from "../projects/store.js";

export interface CheckReport {
  ok: boolean;
  /** Parsed `hyperframes check --json`, or null when the CLI printed nothing parseable. */
  report: unknown;
  /** Raw tail of stderr/stdout when the report could not be parsed. */
  raw?: string;
}

/**
 * CLI `--json` output arrives in two shapes, both preceded by `[INFO]` log lines: pretty-printed (the object starts
 * on a line that is exactly `{`, e.g. `check`, `timeline`) and compact (one whole object per line, e.g. `transcribe`).
 */
export function parseJsonTail(stdout: string): unknown | null {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l === "{");
  if (start >= 0) {
    try {
      return JSON.parse(lines.slice(start).join("\n"));
    } catch {
      // fall through: a stray `{` line that is not the report
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // not JSON: keep looking upward
    }
  }
  return null;
}

const ReportShape = z.looseObject({ ok: z.boolean() });

export async function checkProject(id: string, signal?: AbortSignal): Promise<CheckReport> {
  const res = await runCli(["check", "--json"], { cwd: projectPath(id), signal, timeoutMs: 180_000 });
  const parsed = ReportShape.safeParse(parseJsonTail(res.stdout));
  if (!parsed.success) return { ok: false, report: null, raw: (res.stderr || res.stdout).slice(-4000) };
  return { ok: parsed.data.ok, report: parsed.data };
}

export interface Snapshot {
  /** Project-relative path of the PNG. */
  path: string;
  /** Raw PNG bytes, so the agent loop can attach them to a vision-capable model. */
  bytes: Buffer;
}

/** Capture stills at exact times (seconds). Never calls the Gemini describer: `--describe false`. */
export async function snapshotProject(id: string, times: number[], signal?: AbortSignal): Promise<Snapshot[]> {
  const root = projectPath(id);
  const rel = ".hyperframes/memotion-snaps";
  const outDir = join(root, rel);
  await mkdir(outDir, { recursive: true });
  const res = await runCli(
    ["snapshot", "--at", times.join(","), "--no-end", "--describe", "false", "-o", outDir],
    { cwd: root, signal, timeoutMs: 180_000, env: { GEMINI_API_KEY: "" } },
  );
  if (res.code !== 0) throw new Error(`snapshot failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(-2000)}`);
  const files = (await readdir(outDir)).filter((f) => f.endsWith(".png")).sort();
  const snaps: Snapshot[] = [];
  for (const f of files) snaps.push({ path: `${rel}/${f}`, bytes: await readFile(join(outDir, f)) });
  return snaps;
}

export const DOC_TOPICS = ["data-attributes", "gsap", "compositions", "rendering", "examples", "troubleshooting"] as const;

export async function readDocs(topic: string): Promise<string> {
  if (!(DOC_TOPICS as readonly string[]).includes(topic)) {
    throw new Error(`Unknown docs topic "${topic}". Available: ${DOC_TOPICS.join(", ")}`);
  }
  const res = await runCli(["docs", topic], { cwd: process.cwd(), timeoutMs: 30_000 });
  return res.stdout;
}
