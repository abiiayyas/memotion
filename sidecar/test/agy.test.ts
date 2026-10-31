import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/agent/loop.js";
import { agyIsolated, claimAgy, prepareAgyHome } from "../src/agents/agyMcp.js";
import { agyParser, mayChangeFiles, type CliEvent } from "../src/agents/events.js";
import { buildInvocation, runCliAgent } from "../src/agents/run.js";
import { createProject } from "../src/projects/store.js";
import { getAgentBackend } from "../src/providers/store.js";
import { buildApp } from "../src/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-agy-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const fixture = join(import.meta.dirname, "fixtures", "cli", "agy-write.jsonl");
const lines = readFileSync(fixture, "utf8").split("\n").filter(Boolean);

describe("Antigravity's stream (lines captured from a real run)", () => {
  const events = (): CliEvent[] => {
    const parse = agyParser();
    return lines.flatMap(parse);
  };

  it("gathers a reply sent in pieces into one text, and ignores steps that say nothing", () => {
    expect(events().filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Done." }]);
  });

  it("pairs each tool start with its result, and treats a non-zero exit code as a failure", () => {
    const e = events();
    const starts = e.filter((x) => x.type === "tool-start");
    expect(starts.map((s) => s.type === "tool-start" && s.name)).toEqual(["write_file", "run_command", "mcp__memotion__check"]);
    const results = e.filter((x) => x.type === "tool-result");
    expect(results.map((r) => r.type === "tool-result" && r.ok)).toEqual([true, false, true]);
    expect(results.map((r) => r.type === "tool-result" && r.id)).toEqual(starts.map((s) => s.type === "tool-start" && s.id));
  });

  it("names Memotion's tools like Claude Code's, so the preview reloads after them", () => {
    expect(mayChangeFiles("mcp__memotion__generate_voiceover")).toBe(true);
    expect(mayChangeFiles("write_file")).toBe(true);
    expect(mayChangeFiles("read_file")).toBe(false);
  });

  it("reports a run that did not succeed", () => {
    const parse = agyParser();
    expect(parse('{"event":"result","result":{"status":"ERROR","error":"quota exceeded"}}')).toEqual([{ type: "failure", message: "quota exceeded" }]);
    expect(parse("not json")).toEqual([]);
  });
});

describe("how Antigravity is started", () => {
  it("turns off its permission prompts (the only way it writes files), and sends the prompt as an argument", () => {
    const inv = buildInvocation("agy", { mcpUrl: "http://127.0.0.1:1/mcp/abc", system: "SYSTEM", prompt: "make a video", cwd: "/work/p", isolatedConfigDir: "/tmp/x" });
    expect(inv.args).toEqual(expect.arrayContaining(["--print", "--dangerously-skip-permissions", "--output-format", "stream-json"]));
    expect(inv.args.join(" ")).toContain("make a video");
    expect(inv.args.join(" ")).toContain("SYSTEM");
    expect(inv.stdin).toBeUndefined();
  });

  it("runs in the private home it was given, and in the user's own home otherwise", () => {
    const input = { mcpUrl: "http://127.0.0.1:1/mcp/abc", system: "S", prompt: "p", cwd: "/work/p", isolatedConfigDir: "/tmp/x" };
    expect(buildInvocation("agy", { ...input, agyHome: "/tmp/home" }).env).toEqual({ HOME: "/tmp/home" });
    expect(buildInvocation("agy", input).env).toEqual({});
  });
});

describe("the private home of an Antigravity run", () => {
  const root = mkdtempSync(join(tmpdir(), "memotion-agy-home-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("carries over the sign-in and settings, and none of the user's servers, hooks, plugins or skills", async () => {
    const real = join(root, "real");
    const cli = join(real, ".gemini", "antigravity-cli");
    mkdirSync(cli, { recursive: true });
    mkdirSync(join(real, ".gemini", "config", "skills"), { recursive: true });
    mkdirSync(join(real, "Library", "Keychains"), { recursive: true });
    writeFileSync(join(cli, "settings.json"), '{"model":"M"}');
    writeFileSync(join(cli, "antigravity-oauth-token"), "tok");
    writeFileSync(join(cli, "history.jsonl"), "private");
    writeFileSync(join(real, ".gemini", "config", "mcp_config.json"), '{"mcpServers":{"down":{"serverUrl":"https://example.invalid"}}}');
    writeFileSync(join(real, ".gemini", "config", "hooks.json"), "{}");
    writeFileSync(join(real, "Library", "Keychains", "login.keychain-db"), "keys");

    const home = join(root, "run");
    expect(await prepareAgyHome(home, real)).toBe(home);
    expect(readFileSync(join(home, ".gemini", "antigravity-cli", "settings.json"), "utf8")).toBe('{"model":"M"}');
    expect(readFileSync(join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token"), "utf8")).toBe("tok");
    expect(existsSync(join(home, ".gemini", "antigravity-cli", "history.jsonl"))).toBe(false);
    expect(existsSync(join(home, ".gemini", "config", "mcp_config.json"))).toBe(false);
    expect(existsSync(join(home, ".gemini", "config", "hooks.json"))).toBe(false);
    expect(readFileSync(join(home, "Library", "Keychains", "login.keychain-db"), "utf8")).toBe("keys");

    // A run changes its own copy; and deleting the home afterwards must not reach through the keychain link.
    writeFileSync(join(home, ".gemini", "antigravity-cli", "settings.json"), '{"model":"changed"}');
    expect(lstatSync(join(home, "Library", "Keychains")).isSymbolicLink()).toBe(true);
    rmSync(home, { recursive: true, force: true });
    expect(readFileSync(join(cli, "settings.json"), "utf8")).toBe('{"model":"M"}');
    expect(readFileSync(join(real, "Library", "Keychains", "login.keychain-db"), "utf8")).toBe("keys");
  });

  it("starts without a sign-in or keychain on a computer that has neither", async () => {
    const home = await prepareAgyHome(join(root, "bare-run"), join(root, "nobody"));
    expect(existsSync(join(home, "Library"))).toBe(false);
    expect(existsSync(join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token"))).toBe(false);
  });
});

describe("running Antigravity (a stub `agy` keeps a list of MCP servers, as the real one does)", { timeout: 60_000 }, () => {
  const bin = mkdtempSync(join(tmpdir(), "memotion-agy-bin-"));
  const out = mkdtempSync(join(tmpdir(), "memotion-agy-out-"));
  const oldPath = process.env.PATH;
  let projectId = "";

  // `mcp list` prints the same table as the real tool, with the user's own servers and one left behind by a crash.
  const stub = (printMode: string) => {
    const file = join(bin, "agy");
    writeFileSync(
      file,
      `#!/bin/sh
case "$1" in
  --version) echo "1.4.5" ;;
  mcp)
    echo "$@" >> "$STUB_OUT/mcp-calls.txt"
    echo "$HOME" >> "$STUB_OUT/mcp-homes.txt"
    case "$2" in
      list) printf 'NAME  TYPE  STATUS  COMMAND/URL\\nsupabase  http  enabled  https://mcp.supabase.com/mcp\\nmemotion-run-deadbeef0000  http  enabled  http://127.0.0.1:1/mcp/old\\n' ;;
    esac ;;
  *) printf "%s\\n" "$@" > "$STUB_OUT/print-args.txt"
     echo "$HOME" > "$STUB_OUT/print-home.txt"
${printMode}
esac
`,
    );
    chmodSync(file, 0o755);
  };
  const collect = async (): Promise<AgentEvent[]> => {
    const events: AgentEvent[] = [];
    for await (const ev of runCliAgent(projectId, "Tulis hello", new AbortController().signal, "agy")) events.push(ev);
    return events;
  };
  const mcpCalls = (): string[] => readFileSync(join(out, "mcp-calls.txt"), "utf8").split("\n").filter(Boolean);

  beforeAll(async () => {
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    process.env.STUB_OUT = out;
    projectId = (await createProject({ name: "Agy run", orientation: "landscape" })).id;
  }, 120_000);
  afterAll(() => {
    process.env.PATH = oldPath;
    rmSync(bin, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it.skipIf(!agyIsolated())("runs in a private home that holds only Memotion's server, and leaves the user's own list and home alone", async () => {
    rmSync(join(out, "mcp-calls.txt"), { force: true });
    rmSync(join(out, "mcp-homes.txt"), { force: true });
    stub(`cat "${fixture}"`);
    const ev = await collect();
    expect(ev.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Done." }]);
    expect(ev.at(-1)?.type).toBe("done");

    // Only one call touched the list: adding ours, in the same private home the run itself used.
    const calls = mcpCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^mcp add --type http memotion-run-[0-9a-f]{12} http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]+$/);
    const home = readFileSync(join(out, "print-home.txt"), "utf8").trim();
    expect(home).not.toBe(process.env.HOME);
    expect(readFileSync(join(out, "mcp-homes.txt"), "utf8").trim()).toBe(home);
    // The private home is gone afterwards.
    expect(existsSync(home)).toBe(false);
  });

  it.skipIf(agyIsolated())("adds Memotion's tools for the run only, clears a server a crash left behind, and never touches the user's own", async () => {
    stub(`cat "${fixture}"`);
    const ev = await collect();
    expect(ev.filter((e) => e.type === "text")).toEqual([{ type: "text", text: "Done." }]);
    expect(ev.at(-1)?.type).toBe("done");
    expect(readFileSync(join(out, "print-args.txt"), "utf8")).toContain("--dangerously-skip-permissions");

    const calls = mcpCalls();
    const added = calls.find((c) => c.startsWith("mcp add"));
    expect(added).toMatch(/^mcp add --type http memotion-run-[0-9a-f]{12} http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]+$/);
    const name = /memotion-run-[0-9a-f]{12}/.exec(added ?? "")?.[0] ?? "";
    expect(calls).toContain("mcp remove memotion-run-deadbeef0000");
    expect(calls).toContain(`mcp remove ${name}`);
    expect(calls.some((c) => c.includes("supabase") && c.startsWith("mcp remove"))).toBe(false);
    expect(calls.indexOf(`mcp remove ${name}`)).toBeGreaterThan(calls.indexOf(added ?? ""));
  });

  it.skipIf(agyIsolated())("removes its server and frees the slot even when the run fails", async () => {
    rmSync(join(out, "mcp-calls.txt"), { force: true });
    stub("echo 'quota exceeded' >&2\nexit 4");
    const ev = await collect();
    expect(ev.find((e) => e.type === "error")).toMatchObject({ message: expect.stringMatching(/exit code 4.*quota exceeded/) });
    expect(mcpCalls().filter((c) => c.startsWith("mcp remove memotion-run-") && !c.endsWith("deadbeef0000"))).toHaveLength(1);
    const slot = claimAgy();
    expect(slot).not.toBeNull();
    slot?.();
  });

  it.skipIf(agyIsolated())("allows one Antigravity run at a time, because its list of MCP servers is shared", async () => {
    const slot = claimAgy();
    expect(slot).not.toBeNull();
    const refused = await collect();
    expect(refused[0]).toMatchObject({ type: "error", message: expect.stringMatching(/already working on another project/) });
    slot?.();
  });

  it("is only chosen after the user says yes to turning permission prompts off", async () => {
    stub("true");
    const app = buildApp({ token: "t" });
    const put = (body: unknown) => app.request("/agents/backend", { method: "PUT", headers: { Host: "127.0.0.1:1", Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const refused = await put({ backend: "agy" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "risk_not_accepted" });
    expect(getAgentBackend()).toBe("api");
    expect((await put({ backend: "agy", acceptRisk: false })).status).toBe(409);
    expect((await put({ backend: "agy", acceptRisk: true })).status).toBe(200);
    expect(getAgentBackend()).toBe("agy");
    // The other tools never needed a yes.
    expect((await put({ backend: "api" })).status).toBe(200);
  }); // detection asks every installed agent CLI for its version and sign-in, which can take seconds
});
