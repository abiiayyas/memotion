import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

/** Pinned: the version smoke-tested for this app. Bump deliberately. */
export const HYPERFRAMES_VERSION = "0.8.168";

export function dataDir(): string {
  const override = process.env.MEMOTION_DATA_DIR;
  if (override) return override;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "memotion");
  if (process.platform === "win32") return join(process.env.APPDATA ?? homedir(), "memotion");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "memotion");
}

let port = 0;
/** The port this sidecar listens on, known once the server is up. Agent CLIs call back to it. */
export function setSelfPort(p: number): void {
  port = p;
}
export function selfPort(): number {
  return port;
}

export function projectsDir(): string {
  const dir = join(dataDir(), "projects");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function configPath(): string {
  mkdirSync(dataDir(), { recursive: true });
  return join(dataDir(), "config.json");
}

/** Absolute path to the hyperframes CLI entry, resolved from this package's own dependency. */
export function hyperframesBin(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("hyperframes/package.json");
  return join(pkgPath, "..", "bin", "hyperframes.mjs");
}

/** Env for every CLI child: no telemetry, no update checks, no skill installs, our own ffmpeg if set. */
export function cliEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    DO_NOT_TRACK: "1",
    ...extra,
  };
}
