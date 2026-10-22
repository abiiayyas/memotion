import { childEnv, run } from "./cli.js";

/**
 * Antigravity keeps MCP servers in one list for the whole user account (`agy mcp add`); a run cannot be given its own.
 * So each run adds a server with a name of its own and removes it when the run ends. Only one Antigravity run at a
 * time is allowed, so a run never sees another project's address, and the list is never edited by two runs at once.
 */
const PREFIX = "memotion-run-";

let busy = false;

/** Take the single Antigravity slot. Returns false when another run holds it. */
export function claimAgy(): (() => void) | null {
  if (busy) return null;
  busy = true;
  return () => {
    busy = false;
  };
}

export const agyServerName = (token: string): string => `${PREFIX}${token.slice(0, 12)}`;

async function agyRun(binary: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return run(binary, args, await childEnv(), 15_000);
}

/** Names of servers this app left behind (a crash, a kill) and no run owns. */
export async function staleServers(binary: string): Promise<string[]> {
  const listed = await agyRun(binary, ["mcp", "list"]);
  return listed.out.split("\n").flatMap((line) => {
    const name = /^(\S+)/.exec(line)?.[1];
    return name?.startsWith(PREFIX) ? [name] : [];
  });
}

export async function addAgyServer(binary: string, name: string, url: string): Promise<void> {
  const res = await agyRun(binary, ["mcp", "add", "--type", "http", name, url]);
  if (!res.ok) throw new Error(`Antigravity would not take Memotion's tools: ${res.out.slice(-200)}`);
}

export async function removeAgyServer(binary: string, name: string): Promise<void> {
  await agyRun(binary, ["mcp", "remove", name]);
}

/** Called before a run, while the slot is held: nothing named like ours can be in use. */
export async function removeStaleServers(binary: string): Promise<void> {
  for (const name of await staleServers(binary)) await removeAgyServer(binary, name);
}
