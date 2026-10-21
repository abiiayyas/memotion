import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent, loadHistory, type AgentEvent } from "../src/agent/loop.js";
import { TOOL_SPECS } from "../src/agent/tools.js";
import { createProject, projectPath } from "../src/projects/store.js";
import { upsertProvider } from "../src/providers/store.js";

// config.ts and the key lookup read these lazily, so setting them here is early enough.
const dataDir = mkdtempSync(join(tmpdir(), "memotion-test-"));
process.env.MEMOTION_DATA_DIR = dataDir;
process.env.MEMOTION_API_KEY_MOCK = "test-key";

type Delta = Record<string, unknown>;

interface MockLlm {
  server: Server;
  requests: { messages: { content: unknown }[] }[];
}

/** A scripted OpenAI-compatible /chat/completions endpoint: each request pops the next list of stream deltas. */
function mockLlm(script: Delta[][]): MockLlm {
  const requests: MockLlm["requests"] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      const deltas = script.shift() ?? [{ content: "(script exhausted)" }];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const delta of deltas) {
        res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return { server, requests };
}

describe("agent loop", () => {
  let llm: MockLlm;
  let projectId: string;

  beforeAll(async () => {
    llm = mockLlm([
      // Round 1: a tool call whose arguments arrive split across chunks, as real providers do.
      [
        { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "write_file", arguments: '{"path":"notes.md",' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '"content":"hello"}' } }] },
      ],
      // Round 2: a tool call that must fail safely (path escapes the project).
      [{ tool_calls: [{ index: 0, id: "call_b", type: "function", function: { name: "read_file", arguments: '{"path":"../../etc/passwd"}' } }] }],
      // Round 3: final answer without having run check: the director asks once, the answer is not kept.
      [{ content: "Draft: " }, { content: "wrote notes." }],
      // Round 4: final answer after the reminder.
      [{ content: "Done: " }, { content: "wrote notes." }],
    ]);
    await new Promise<void>((r) => llm.server.listen(0, "127.0.0.1", r));
    const addr = llm.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no port");
    upsertProvider({ id: "mock", name: "Mock", baseURL: `http://127.0.0.1:${addr.port}/v1`, model: "m" });
    projectId = (await createProject({ name: "Agent test", orientation: "landscape" })).id;
  }, 120_000);

  afterAll(() => {
    llm.server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("assembles streamed tool calls, runs them, survives a rejected path, and ends with text", async () => {
    const events: AgentEvent[] = [];
    for await (const ev of runAgent(projectId, "make a note", new AbortController().signal)) events.push(ev);

    expect(readFileSync(join(projectPath(projectId), "notes.md"), "utf8")).toBe("hello");

    const results = events.filter((e) => e.type === "tool-result");
    expect(results.map((e) => e.ok)).toEqual([true, false]);
    expect(events.filter((e) => e.type === "files-changed")).toHaveLength(1);
    const text = events.filter((e) => e.type === "text").map((e) => e.text).join("");
    expect(text).toBe("Draft: wrote notes.Done: wrote notes.");
    expect(llm.requests.at(-1)?.messages.at(-1)?.content).toMatch(/Run `check` now/);
    expect(events.at(-1)?.type).toBe("done");
  }, 60_000);

  it("persists history where every assistant tool_call has a matching tool result", async () => {
    const history = await loadHistory(projectId);
    const callIds = history.flatMap((m) => (m.role === "assistant" ? (m.tool_calls ?? []).map((t) => t.id) : []));
    const resultIds = history.flatMap((m) => (m.role === "tool" ? [m.tool_call_id] : []));
    expect(callIds).toEqual(["call_a", "call_b"]);
    expect(resultIds).toEqual(callIds);
  });

  it("sends the tool schema and the project's system prompt on every request", () => {
    const first = llm.requests[0] as { tools: unknown[]; messages: { role: string; content: string }[] };
    expect(first.tools).toHaveLength(TOOL_SPECS.length);
    expect(first.messages[0]?.role).toBe("system");
    expect(first.messages[0]?.content).toContain("1920x1080");
  });
});
