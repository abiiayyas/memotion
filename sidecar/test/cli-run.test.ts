import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimProject, loadHistory, type AgentEvent } from "../src/agent/loop.js";
import { childEnv } from "../src/agents/cli.js";
import { openRunScope } from "../src/agents/mcp.js";
import { buildInvocation, runCliAgent, withRecentConversation } from "../src/agents/run.js";
import { createProject } from "../src/projects/store.js";
import { buildApp } from "../src/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-cli-run-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const input = { mcpUrl: "http://127.0.0.1:1/mcp/abc", system: "SYSTEM", prompt: "make a video", cwd: "/work/p", isolatedConfigDir: "/tmp/empty-cfg" };

describe("how each CLI is started", () => {
  it("Claude Code: project-only settings, only Memotion's MCP, no shell or web, prompt on stdin", () => {
    const inv = buildInvocation("claude", input);
    const a = inv.args;
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("project");
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    const denied = a.slice(a.indexOf("--disallowedTools") + 1, a.indexOf("--append-system-prompt"));
    expect(denied).toEqual(expect.arrayContaining(["Bash", "WebFetch", "WebSearch"]));
    expect(JSON.parse(a[a.indexOf("--mcp-config") + 1] ?? "{}")).toEqual({ mcpServers: { memotion: { type: "http", url: input.mcpUrl } } });
    expect(inv.stdin).toBe("make a video");
    expect(a).not.toContain("make a video");
  });

  it("Codex: workspace-only sandbox, user config ignored, Memotion's tools pre-approved, prompt on stdin", () => {
    const inv = buildInvocation("codex", input);
    const a = inv.args;
    expect(a[a.indexOf("-s") + 1]).toBe("workspace-write");
    expect(a).toContain("--ignore-user-config");
    expect(a).toContain('mcp_servers.memotion.url="http://127.0.0.1:1/mcp/abc"');
    expect(a).toContain('mcp_servers.memotion.default_tools_approval_mode="approve"');
    expect(a.at(-1)).toBe("-");
    expect(inv.stdin).toContain("SYSTEM");
    expect(inv.stdin).toContain("make a video");
  });

  it("OpenCode: empty config home, shell and web denied, only Memotion's MCP added", () => {
    const inv = buildInvocation("opencode", input);
    expect(inv.env.XDG_CONFIG_HOME).toBe("/tmp/empty-cfg");
    const cfg = JSON.parse(inv.env.OPENCODE_CONFIG_CONTENT ?? "{}");
    expect(cfg.mcp.memotion.url).toBe(input.mcpUrl);
    expect(cfg.permission).toMatchObject({ bash: "deny", webfetch: "deny", external_directory: "deny" });
  });

  it("never hands Memotion's own secrets to a CLI that can run shell commands", async () => {
    process.env.MEMOTION_TOKEN = "super-secret";
    process.env.MEMOTION_API_KEY_DEEPSEEK = "sk-secret";
    const env = await childEnv();
    expect(Object.keys(env).filter((k) => k.startsWith("MEMOTION_"))).toEqual([]);
    expect(env.PATH).toBeTruthy();
  });
});

describe("conversation carried into a fresh CLI run", () => {
  it("puts the last exchanges before the new message, skipping tool plumbing, and is plain when there is no history", () => {
    const history = [
      { role: "user", content: "Make a coffee teaser" },
      { role: "assistant", content: null },
      { role: "tool", content: "ignored tool output" },
      { role: "assistant", content: "Done: 3 scenes." },
    ];
    const out = withRecentConversation(history, "Make it bigger");
    expect(out).toContain("User: Make a coffee teaser");
    expect(out).toContain("You: Done: 3 scenes.");
    expect(out).not.toContain("ignored tool output");
    expect(out.endsWith("New message from the user:\nMake it bigger")).toBe(true);
    expect(withRecentConversation([], "Hello")).toBe("Hello");
  });

  it("keeps only the most recent turns and cuts very long ones", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `turn-${i} ${"x".repeat(3000)}` }));
    const out = withRecentConversation(many, "next");
    expect(out).toContain("turn-19");
    expect(out).not.toContain("turn-13 ");
    expect(out.length).toBeLessThan(6 * 1600 + 400);
  });
});

describe("the MCP endpoint a CLI calls back", () => {
  const app = buildApp({ token: "bearer-token" });
  let projectId = "";
  beforeAll(async () => {
    projectId = (await createProject({ name: "Mcp", orientation: "landscape" })).id;
  });
  const rpc = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:1" }, body: JSON.stringify(body) });

  it("answers initialize and lists only the tools a CLI lacks, not file tools", async () => {
    const scope = openRunScope(projectId, new AbortController().signal);
    const init = await (await rpc(scope.path, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json();
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("memotion");
    const list = await (await rpc(scope.path, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["check", "snapshot", "read_docs", "generate_voiceover", "capture_website", "generate_image"]));
    expect(names).not.toEqual(expect.arrayContaining(["write_file"]));
    expect(names).not.toContain("read_file");
    expect(names).not.toContain("edit_file");
    scope.close();
  });

  it("runs a tool against the run's project, rejects tools outside the offered set, and accepts notifications", async () => {
    const scope = openRunScope(projectId, new AbortController().signal);
    const ok = await (await rpc(scope.path, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_media", arguments: {} } })).json();
    expect(ok.result.isError).toBe(false);
    expect(ok.result.content[0].text).toContain("none imported");
    const refused = await (await rpc(scope.path, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "write_file", arguments: { path: "x.html", content: "x" } } })).json();
    expect(refused.error.code).toBe(-32602);
    const note = await rpc(scope.path, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    scope.close();
  });

  it("is a capability: it needs no bearer token, but only a live run's token works", async () => {
    const scope = openRunScope(projectId, new AbortController().signal);
    expect((await rpc(scope.path, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    expect((await rpc("/mcp/not-a-token", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
    scope.close();
    expect((await rpc(scope.path, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404); // dies with the run
    // The rest of the API still demands the bearer token.
    expect((await app.request("/projects", { headers: { host: "127.0.0.1:1" } })).status).toBe(401);
  });
});

describe("running a CLI agent (a stub `claude` replays a real captured stream)", () => {
  const bin = mkdtempSync(join(tmpdir(), "memotion-stub-bin-"));
  const out = mkdtempSync(join(tmpdir(), "memotion-stub-out-"));
  const fixture = join(import.meta.dirname, "fixtures", "cli", "claude-write.jsonl");
  const oldPath = process.env.PATH;
  let projectId = "";

  const stub = (body: string) => {
    const file = join(bin, "claude");
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  };
  const collect = async (text: string, signal = new AbortController().signal): Promise<AgentEvent[]> => {
    const events: AgentEvent[] = [];
    for await (const ev of runCliAgent(projectId, text, signal, "claude")) events.push(ev);
    return events;
  };

  beforeAll(async () => {
    process.env.PATH = `${bin}${delimiter}${oldPath}`;
    process.env.STUB_OUT = out;
    process.env.STUB_FIXTURE = fixture;
    projectId = (await createProject({ name: "Cli run", orientation: "landscape" })).id;
  }, 120_000);
  afterAll(() => {
    process.env.PATH = oldPath;
    rmSync(bin, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it("turns the stream into chat events, records the turn, and gives the child no secrets", async () => {
    process.env.MEMOTION_TOKEN = "super-secret";
    stub('cat > "$STUB_OUT/stdin.txt"\nenv > "$STUB_OUT/env.txt"\nprintf "%s\\n" "$@" > "$STUB_OUT/args.txt"\ncat "$STUB_FIXTURE"');
    const ev = await collect("Tulis hello");

    expect(ev.filter((e) => e.type === "tool-start").map((e) => (e.type === "tool-start" ? e.name : ""))).toEqual(["Write hello.txt"]);
    expect(ev.filter((e) => e.type === "tool-result").map((e) => (e.type === "tool-result" ? e.ok : null))).toEqual([true]);
    expect(ev.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : ""))).toEqual(["DONE"]);
    expect(ev.some((e) => e.type === "files-changed")).toBe(true);
    expect(ev.some((e) => e.type === "error")).toBe(false);
    expect(ev.at(-1)?.type).toBe("done");

    expect(readFileSync(join(out, "stdin.txt"), "utf8")).toBe("Tulis hello");
    expect(readFileSync(join(out, "args.txt"), "utf8")).toContain("--strict-mcp-config");
    expect(readFileSync(join(out, "env.txt"), "utf8")).not.toMatch(/MEMOTION_TOKEN|super-secret/);

    const history = await loadHistory(projectId);
    expect(history.slice(-2)).toEqual([
      { role: "user", content: "Tulis hello" },
      { role: "assistant", content: "DONE" },
    ]);
  });

  it("reports the CLI's own error line, and a non-zero exit with what it printed on stderr", async () => {
    stub('echo \'{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}\'');
    const failed = (await collect("x")).find((e) => e.type === "error");
    expect(failed?.type === "error" && failed.message).toBe("Not logged in · Please run /login");

    stub('echo "usage limit reached for this account" >&2\nexit 3');
    const crashed = (await collect("x")).find((e) => e.type === "error");
    expect(crashed?.type === "error" && crashed.message).toMatch(/exit code 3.*usage limit reached/);
  });

  it("stops the child and the helper processes it started when the user cancels, instead of waiting for them", async () => {
    // The stub says something, then starts a long-running helper that inherits the pipes (as a real agent's shell would).
    stub('echo \'{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}\'\nsleep 30 &\necho $! > "$STUB_OUT/helper.pid"\nwait');
    const ctl = new AbortController();
    const events: AgentEvent[] = [];
    const started = Date.now();
    for await (const ev of runCliAgent(projectId, "x", ctl.signal, "claude")) {
      events.push(ev);
      if (ev.type === "text") ctl.abort(); // the first sign of life: cancel now, no guessing how long that takes
    }
    expect(events.find((e) => e.type === "error")).toMatchObject({ message: "Cancelled." });
    // The helper holds the output pipe for 30 s. The run can only end earlier if the helper was stopped too.
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("refuses a second run on the same project, and an agent that cannot work", async () => {
    const release = claimProject(projectId);
    expect(release).not.toBeNull();
    const busy: AgentEvent[] = [];
    for await (const ev of runCliAgent(projectId, "x", new AbortController().signal, "claude")) busy.push(ev);
    expect(busy[0]).toMatchObject({ type: "error", message: expect.stringMatching(/already working/) });
    release?.();

    const unsupported: AgentEvent[] = [];
    for await (const ev of runCliAgent(projectId, "x", new AbortController().signal, "agy")) unsupported.push(ev);
    expect(unsupported[0]).toMatchObject({ type: "error", message: expect.stringMatching(/Antigravity cannot be used/) });
    expect(existsSync(join(out, "never"))).toBe(false);
  });
});
