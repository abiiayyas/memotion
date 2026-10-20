import { z } from "zod";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "./cli.js";
import { projectPath, readMeta, touch } from "../projects/store.js";

export type RenderQuality = "draft" | "standard" | "high";

export interface RenderJob {
  id: string;
  projectId: string;
  status: "running" | "done" | "failed" | "cancelled";
  /** 0-100 */
  pct: number;
  stage: string;
  /** Project-relative output path once done. */
  output?: string;
  /** Absolute path of the finished file, for "reveal in Finder". */
  outputPath?: string;
  error?: string;
}

const QUALITY_FLAG: Record<RenderQuality, string> = { draft: "draft", standard: "looks", high: "delivery" };

const jobs = new Map<string, RenderJob>();
const aborts = new Map<string, AbortController>();
export const renderEvents = new EventEmitter();

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id);
}

export function listJobs(projectId: string): RenderJob[] {
  return [...jobs.values()].filter((j) => j.projectId === projectId);
}

export function cancelJob(id: string): void {
  aborts.get(id)?.abort();
}

function update(job: RenderJob, patch: Partial<RenderJob>): void {
  Object.assign(job, patch);
  renderEvents.emit(job.id, { ...job });
}

const ProgressLine = z.object({ code: z.string().default("render"), pct: z.number() });

/** Parse the CLI's structured progress lines: `@hf-progress {"code":"encode","done":10,"total":300,"pct":3}`. */
export function parseProgress(line: string): { code: string; pct: number } | null {
  if (!line.startsWith("@hf-progress ")) return null;
  try {
    const parsed = ProgressLine.safeParse(JSON.parse(line.slice("@hf-progress ".length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Start a render in the background and return its job immediately; progress arrives on `renderEvents`. */
export async function startRender(
  projectId: string,
  opts: { quality?: RenderQuality; fps?: number } = {},
): Promise<RenderJob> {
  const meta = await readMeta(projectId);
  const fps = opts.fps ?? meta.fps;
  const quality = opts.quality ?? "standard";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const output = `renders/${meta.orientation}-${fps}fps-${stamp}.mp4`;
  const root = projectPath(projectId);
  await mkdir(join(root, "renders"), { recursive: true });

  const job: RenderJob = {
    id: randomBytes(6).toString("hex"),
    projectId,
    status: "running",
    pct: 0,
    stage: "starting",
  };
  jobs.set(job.id, job);
  const abort = new AbortController();
  aborts.set(job.id, abort);

  void runCli(["render", "-o", output, "--fps", String(fps), "-q", QUALITY_FLAG[quality]], {
    cwd: root,
    signal: abort.signal,
    onLine: (line) => {
      const p = parseProgress(line);
      if (p) update(job, { pct: p.pct, stage: p.code });
    },
  })
    .then(async (res) => {
      if (res.code === 0) {
        update(job, { status: "done", pct: 100, stage: "done", output, outputPath: join(root, output) });
        await touch(projectId);
      } else {
        update(job, { status: "failed", error: (res.stderr || res.stdout).slice(-2000) || `exit ${res.code}` });
      }
    })
    .catch((err: Error) => {
      update(job, abort.signal.aborted ? { status: "cancelled" } : { status: "failed", error: err.message });
    })
    .finally(() => aborts.delete(job.id));

  return job;
}
