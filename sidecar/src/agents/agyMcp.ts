import { copyFile, mkdir, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { childEnv, run } from "./cli.js";

/**
 * Antigravity starts every MCP server in the user's account-wide list (`~/.gemini/config/mcp_config.json`) and waits
 * for all of them before the first model call, with no timeout: one personal server that is down (measured: a remote
 * one whose host did not answer) left a run silent for minutes and, in the end, cancelled. It also loads the user's
 * hooks, plugins and skills. A run cannot be given its own list, but it can be given its own home folder.
 *
 * Where that works (macOS, the only place it was measured) each run gets a private `HOME` holding only Memotion's
 * server, the sign-in and the user's settings file. Everywhere else a run adds a server with a name of its own to the
 * shared list and removes it when the run ends, and only one run at a time is allowed so the list is never edited by
 * two runs at once.
 */
const PREFIX = "memotion-run-";

/** Does a run get its own home folder? */
export const agyIsolated = (): boolean => process.platform === "darwin";

/** Files of `~/.gemini/antigravity-cli` a run needs: the user's settings (model, permission rules) and the sign-in token. */
const KEEP = ["settings.json", "antigravity-oauth-token"];

/**
 * Fill `root` as a home folder for one run and return it. Sign-in lives in the macOS keychain, which is found through
 * `~/Library/Keychains`, so that folder is linked, never copied. The two files in `KEEP` are copied: a run can change
 * its copy and the user's stay as they were. Nothing else of the user's configuration is carried over.
 */
export async function prepareAgyHome(root: string, realHome = homedir()): Promise<string> {
  const store = join(root, ".gemini", "antigravity-cli");
  await mkdir(store, { recursive: true });
  await mkdir(join(root, ".gemini", "config"), { recursive: true });
  for (const name of KEEP) await copyFile(join(realHome, ".gemini", "antigravity-cli", name), join(store, name)).catch(() => undefined);
  const keychains = join(realHome, "Library", "Keychains");
  if (await stat(keychains).then(() => true, () => false)) {
    await mkdir(join(root, "Library"), { recursive: true });
    await symlink(keychains, join(root, "Library", "Keychains"));
  }
  return root;
}

let busy = false;

/** Take the single Antigravity slot (shared list only). Returns false when another run holds it. */
export function claimAgy(): (() => void) | null {
  if (busy) return null;
  busy = true;
  return () => {
    busy = false;
  };
}

export const agyServerName = (token: string): string => `${PREFIX}${token.slice(0, 12)}`;

/** `home` is the private home of an isolated run; without it the user's own list is the one addressed. */
async function agyRun(binary: string, args: string[], home?: string): Promise<{ ok: boolean; out: string }> {
  return run(binary, args, await childEnv(home ? { HOME: home } : {}), 15_000);
}

/** Names of servers this app left behind (a crash, a kill) and no run owns. */
export async function staleServers(binary: string): Promise<string[]> {
  const listed = await agyRun(binary, ["mcp", "list"]);
  return listed.out.split("\n").flatMap((line) => {
    const name = /^(\S+)/.exec(line)?.[1];
    return name?.startsWith(PREFIX) ? [name] : [];
  });
}

export async function addAgyServer(binary: string, name: string, url: string, home?: string): Promise<void> {
  const res = await agyRun(binary, ["mcp", "add", "--type", "http", name, url], home);
  if (!res.ok) throw new Error(`Antigravity would not take Memotion's tools: ${res.out.slice(-200)}`);
}

export async function removeAgyServer(binary: string, name: string): Promise<void> {
  await agyRun(binary, ["mcp", "remove", name]);
}

/** Called before a run on the shared list, while the slot is held: nothing named like ours can be in use. */
export async function removeStaleServers(binary: string): Promise<void> {
  for (const name of await staleServers(binary)) await removeAgyServer(binary, name);
}
