import { tmpdir } from "node:os";
import { z } from "zod";
import { runCli } from "./cli.js";
import { parseJsonTail } from "./tools.js";

/** What Memotion needs on this computer to preview and render. Everything else `doctor` reports is optional. */
export interface SystemCheck {
  name: "FFmpeg" | "FFprobe" | "Chrome";
  ok: boolean;
  detail: string;
  /** What the user can do about it, when it is not ok. */
  fix?: string;
}

const Doctor = z.object({
  checks: z.array(z.looseObject({ name: z.string(), ok: z.boolean(), detail: z.string().optional(), hint: z.string().optional() })),
});

const NEEDED = ["FFmpeg", "FFprobe", "Chrome"] as const;

const FIX: Record<(typeof NEEDED)[number], string> = {
  FFmpeg: "Install it, for example with Homebrew: brew install ffmpeg. Memotion does not install it for you.",
  FFprobe: "It comes with ffmpeg: brew install ffmpeg.",
  Chrome: "Memotion can download the browser it renders with (about 150 MB). Use the button.",
};

/** Pure: pick the three checks out of a `doctor --json` report. A check the report lacks counts as missing. */
export function systemFromDoctor(report: unknown): SystemCheck[] {
  const parsed = Doctor.safeParse(report);
  const checks = parsed.success ? parsed.data.checks : [];
  return NEEDED.map((name) => {
    const found = checks.find((c) => c.name === name);
    if (!found) return { name, ok: false, detail: "Could not be checked.", fix: FIX[name] };
    return { name, ok: found.ok, detail: found.detail ?? "", ...(found.ok ? {} : { fix: FIX[name] }) };
  });
}

export async function checkSystem(): Promise<SystemCheck[]> {
  const res = await runCli(["doctor", "--json"], { cwd: tmpdir(), timeoutMs: 60_000 });
  return systemFromDoctor(parseJsonTail(res.stdout));
}

/** Download Chrome for rendering (the CLI keeps it in its own cache folder). Only called after the user agreed. */
export async function downloadChrome(signal?: AbortSignal): Promise<void> {
  const res = await runCli(["browser", "ensure"], { cwd: tmpdir(), timeoutMs: 600_000, signal });
  if (res.code !== 0) throw new Error(`Could not download Chrome: ${(res.stderr || res.stdout).slice(-300) || `exit ${res.code}`}`);
}
