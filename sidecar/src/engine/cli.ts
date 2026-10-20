import { spawn } from "node:child_process";
import { cliEnv, hyperframesBin } from "../config.js";

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Called per output line (stdout and stderr), e.g. to parse `@hf-progress` JSON. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const MAX_CAPTURE = 256 * 1024;

/** Run the pinned hyperframes CLI with this process's own Node. Output is captured, capped to the last 256 KiB. */
export function runCli(args: string[], opts: CliOptions): Promise<CliResult> {
  const { promise, resolve, reject } = Promise.withResolvers<CliResult>();
  const child = spawn(process.execPath, [hyperframesBin(), ...args], {
    cwd: opts.cwd,
    env: cliEnv(opts.env),
    stdio: ["ignore", "pipe", "pipe"],
    signal: opts.signal,
  });
  let stdout = "";
  let stderr = "";
  const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;

  for (const stream of ["stdout", "stderr"] as const) {
    let pending = "";
    child[stream].setEncoding("utf8");
    child[stream].on("data", (chunk: string) => {
      if (stream === "stdout") stdout = (stdout + chunk).slice(-MAX_CAPTURE);
      else stderr = (stderr + chunk).slice(-MAX_CAPTURE);
      if (!opts.onLine) return;
      // Progress bars redraw with \r; treat both as line breaks.
      const parts = (pending + chunk).split(/\r|\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) if (line) opts.onLine(line, stream);
    });
  }

  child.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr });
  });
  return promise;
}
