import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";

/** Command-line coding agents Memotion knows how to start. */
export type CliId = "claude" | "codex" | "opencode";

interface CliSpec {
  label: string;
  vendor: string;
  binary: string;
  install: string;
  signIn: string;
}

export const CLI_SPECS: Record<CliId, CliSpec> = {
  claude: {
    label: "Claude Code",
    vendor: "Anthropic",
    binary: "claude",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    signIn: "claude auth login",
  },
  codex: {
    label: "Codex",
    vendor: "OpenAI",
    binary: "codex",
    install: "npm i -g @openai/codex",
    signIn: "codex login",
  },
  opencode: {
    label: "OpenCode",
    vendor: "OpenCode",
    binary: "opencode",
    install: "curl -fsSL https://opencode.ai/install | bash",
    signIn: "opencode auth login",
  },
};

export const CLI_IDS: CliId[] = ["claude", "codex", "opencode"];

export function isCliId(v: string): v is CliId {
  return v in CLI_SPECS;
}

export interface CliInfo {
  id: CliId;
  label: string;
  vendor: string;
  found: boolean;
  path?: string;
  version?: string;
  /** True: signed in. False: found but not signed in. null: not checked for this tool. */
  signedIn: boolean | null;
  install: string;
  signInCommand: string;
}

// ── PATH ─────────────────────────────────────────────────────────────────────────────────

/** Where these tools usually live, for apps started from the Dock, which get a minimal PATH. */
function commonDirs(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    join(home, ".opencode", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".claude", "local"),
    join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

export function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<{ ok: boolean; out: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; out: string }>();
  execFile(cmd, args, { env, timeout, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
  });
  return promise;
}

let loginPath: Promise<string[]> | undefined;

/**
 * The PATH the user's terminal has. Node version managers (nvm, fnm) and installers add their folders in shell
 * start-up files, so a program started from the Dock does not see them; `codex` installed with npm under nvm is
 * only found this way. Read once per run of the app.
 */
export function loginShellPath(): Promise<string[]> {
  loginPath ??= (async () => {
    if (process.platform === "win32") return [];
    const shell = process.env.SHELL ?? "/bin/zsh";
    const res = await run(shell, ["-lic", 'printf "__PATH__%s__END__" "$PATH"'], process.env, 6000);
    const found = /__PATH__(.*)__END__/s.exec(res.out)?.[1];
    return found ? found.split(delimiter).filter(Boolean) : [];
  })();
  return loginPath;
}

/** Process PATH, then the login shell's, then the usual folders, without repeats. */
export async function searchPath(): Promise<string[]> {
  const all = [...(process.env.PATH ?? "").split(delimiter), ...(await loginShellPath()), ...commonDirs()].filter(Boolean);
  const seen: Record<string, true> = {};
  return all.filter((d) => {
    if (seen[d]) return false;
    seen[d] = true;
    return true;
  });
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(binary: string): Promise<string | null> {
  for (const dir of await searchPath()) {
    const candidate = join(dir, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Environment for an agent CLI child. It gets the full search PATH (a `#!/usr/bin/env node` script needs node on
 * it) and none of Memotion's own secrets: the sidecar's token and API-key overrides must not be readable by a
 * program that can run shell commands.
 */
export async function childEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("MEMOTION_") || k === "ELECTRON_RUN_AS_NODE") continue;
    env[k] = v;
  }
  env.PATH = (await searchPath()).join(delimiter);
  return { ...env, ...extra };
}

// ── detection ────────────────────────────────────────────────────────────────────────────

const ClaudeStatus = z.looseObject({ loggedIn: z.boolean() });

async function signedIn(id: CliId, path: string, env: NodeJS.ProcessEnv): Promise<boolean | null> {
  if (id === "claude") {
    const res = await run(path, ["auth", "status"], env, 8000);
    const parsed = ClaudeStatus.safeParse(safeJson(res.out));
    return parsed.success ? parsed.data.loggedIn : null;
  }
  if (id === "codex") {
    const res = await run(path, ["login", "status"], env, 8000);
    if (/logged in/i.test(res.out)) return true;
    return /not logged in|not signed in/i.test(res.out) ? false : null;
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function detectOne(id: CliId, env: NodeJS.ProcessEnv): Promise<CliInfo> {
  const spec = CLI_SPECS[id];
  const base: CliInfo = {
    id,
    label: spec.label,
    vendor: spec.vendor,
    found: false,
    signedIn: null,
    install: spec.install,
    signInCommand: spec.signIn,
  };
  const path = await findOnPath(spec.binary);
  if (!path) return base;
  const [version, auth] = await Promise.all([run(path, ["--version"], env, 8000), signedIn(id, path, env)]);
  return { ...base, found: true, path, version: version.out.split("\n")[0]?.trim() || undefined, signedIn: auth };
}

export async function detectClis(): Promise<CliInfo[]> {
  const env = await childEnv();
  return Promise.all(CLI_IDS.map((id) => detectOne(id, env)));
}
