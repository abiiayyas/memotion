import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mayChangeFiles, parseClaudeLine, parseCodexLine, parseOpenCodeLine, type CliEvent } from "../src/agents/events.js";

const fixture = (name: string): string[] => readFileSync(join(import.meta.dirname, "fixtures", "cli", name), "utf8").trim().split("\n");
const all = (lines: string[], parse: (l: string) => CliEvent[]): CliEvent[] => lines.flatMap(parse);

describe("Claude Code stream (captured from claude 2.1.306)", () => {
  const events = all(fixture("claude-write.jsonl"), parseClaudeLine);

  it("turns a Write call and its result into a chip pair, then the closing text", () => {
    expect(events.map((e) => e.type)).toEqual(["tool-start", "tool-result", "text"]);
    const start = events[0];
    const result = events[1];
    expect(start?.type === "tool-start" && start.name).toBe("Write");
    expect(result?.type === "tool-result" && result.ok).toBe(true);
    // The result belongs to the call it answers.
    expect(result?.type === "tool-result" && start?.type === "tool-start" && result.id === start.id).toBe(true);
    expect(events[2]).toEqual({ type: "text", text: "DONE" });
  });

  it("reports a failed run as a failure, and ignores lines that are not JSON", () => {
    expect(parseClaudeLine('{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}')).toEqual([
      { type: "failure", message: "Not logged in · Please run /login" },
    ]);
    expect(parseClaudeLine("hook noise, not json")).toEqual([]);
    expect(parseClaudeLine('{"type":"result","is_error":false,"result":"DONE"}')).toEqual([]);
  });

  it("marks a tool result with is_error as not ok", () => {
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "permission denied" }] } });
    expect(parseClaudeLine(line)).toEqual([{ type: "tool-result", id: "t1", ok: false, summary: "permission denied" }]);
  });
});

describe("Codex stream (captured from codex-cli 0.160.1)", () => {
  const events = all(fixture("codex-shell.jsonl"), parseCodexLine);

  it("pairs a shell command's start and completion, then the message", () => {
    expect(events.map((e) => e.type)).toEqual(["tool-start", "tool-result", "text"]);
    const start = events[0];
    const done = events[1];
    expect(start?.type === "tool-start" && start.name).toBe("shell");
    expect(done?.type === "tool-result" && start?.type === "tool-start" && done.id === start.id).toBe(true);
    expect(done?.type === "tool-result" && done.ok).toBe(true);
    expect(events[2]).toEqual({ type: "text", text: "DONE" });
  });

  it("treats a non-zero exit code as a failed tool and a turn failure as a failure", () => {
    const failed = parseCodexLine(JSON.stringify({ type: "item.completed", item: { id: "x9", type: "command_execution", command: "false", exit_code: 1, status: "failed" } }));
    expect(failed.at(-1)).toMatchObject({ type: "tool-result", ok: false });
    expect(parseCodexLine('{"type":"turn.failed","error":{"message":"usage limit reached"}}')).toEqual([{ type: "failure", message: "usage limit reached" }]);
  });
});

describe("OpenCode stream (captured from opencode 1.19.3)", () => {
  const events = all(fixture("opencode-tools.jsonl"), parseOpenCodeLine);

  it("reports each tool as a start and result, in order, then the answer", () => {
    expect(events.map((e) => e.type)).toEqual(["tool-start", "tool-result", "tool-start", "tool-result", "text"]);
    expect(events.filter((e) => e.type === "tool-start").map((e) => (e.type === "tool-start" ? e.name : ""))).toEqual(["bash", "apply_patch"]);
    expect(events.at(-1)).toEqual({ type: "text", text: "DONE" });
  });

  it("surfaces an error event with its message", () => {
    expect(parseOpenCodeLine('{"type":"error","error":{"name":"APIError","data":{"message":"Invalid API key"}}}')).toEqual([{ type: "failure", message: "Invalid API key" }]);
  });
});

describe("which tools may change project files", () => {
  it("knows each CLI's writers and Memotion's own tools, and not plain reads", () => {
    for (const name of ["Write", "Edit", "shell", "apply_patch", "mcp__memotion__generate_voiceover"]) expect(mayChangeFiles(name)).toBe(true);
    for (const name of ["Read", "Glob", "Grep"]) expect(mayChangeFiles(name)).toBe(false);
  });
});
