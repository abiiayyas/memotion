import { z } from "zod";
import type { CliId } from "./cli.js";

/** What every agent CLI's stream is reduced to. */
export type CliEvent =
  | { type: "text"; text: string }
  | { type: "tool-start"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; ok: boolean; summary: string }
  | { type: "failure"; message: string };

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Last path segment, so tool chips stay short. */
function leaf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

// ── Claude Code: --output-format stream-json ─────────────────────────────────────────────

const ToolResultContent = z.union([z.string(), z.array(z.looseObject({ type: z.string(), text: z.string().optional() }))]);

const ClaudeTextBlock = z.looseObject({ type: z.literal("text"), text: z.string() });
const ClaudeToolUse = z.looseObject({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() });
const ClaudeToolResult = z.looseObject({ type: z.literal("tool_result"), tool_use_id: z.string(), is_error: z.boolean().optional(), content: ToolResultContent.optional() });

const ClaudeAssistant = z.looseObject({ type: z.literal("assistant"), message: z.looseObject({ content: z.array(z.unknown()) }) });
const ClaudeUser = z.looseObject({ type: z.literal("user"), message: z.looseObject({ content: z.union([z.string(), z.array(z.unknown())]) }) });
const ClaudeResult = z.looseObject({ type: z.literal("result"), is_error: z.boolean().optional(), result: z.string().optional() });

const FilePathInput = z.looseObject({ file_path: z.string().optional(), path: z.string().optional(), pattern: z.string().optional() });

function claudeChip(name: string, input: unknown): string {
  const parsed = FilePathInput.safeParse(input);
  const target = parsed.success ? (parsed.data.file_path ?? parsed.data.path ?? parsed.data.pattern) : undefined;
  return target ? `${name} ${leaf(target)}` : name;
}

export function parseClaudeLine(line: string): CliEvent[] {
  const raw = parseJson(line);
  const out: CliEvent[] = [];

  const assistant = ClaudeAssistant.safeParse(raw);
  if (assistant.success) {
    for (const block of assistant.data.message.content) {
      const text = ClaudeTextBlock.safeParse(block);
      if (text.success) {
        if (text.data.text.length > 0) out.push({ type: "text", text: text.data.text });
        continue;
      }
      const use = ClaudeToolUse.safeParse(block);
      if (use.success) out.push({ type: "tool-start", id: use.data.id, name: use.data.name, args: use.data.input });
    }
    return out;
  }

  const user = ClaudeUser.safeParse(raw);
  if (user.success) {
    const blocks = Array.isArray(user.data.message.content) ? user.data.message.content : [];
    for (const block of blocks) {
      const res = ClaudeToolResult.safeParse(block);
      if (!res.success) continue;
      const content = res.data.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join(" ") : "";
      out.push({ type: "tool-result", id: res.data.tool_use_id, ok: res.data.is_error !== true, summary: clip(text.replace(/\s+/g, " ").trim(), 120) });
    }
    return out;
  }

  const result = ClaudeResult.safeParse(raw);
  if (result.success && result.data.is_error === true) out.push({ type: "failure", message: result.data.result || "Claude Code reported an error." });
  return out;
}

/** The chip name Memotion shows for a Claude tool. */
export function claudeToolLabel(name: string, args: unknown): string {
  return claudeChip(name.replace(/^mcp__memotion__/, ""), args);
}

// ── Codex: exec --json ───────────────────────────────────────────────────────────────────

const CodexItem = z.looseObject({
  id: z.string().optional(),
  type: z.string(),
  text: z.string().optional(),
  command: z.string().optional(),
  exit_code: z.number().nullable().optional(),
  status: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.unknown().optional(),
  changes: z.array(z.looseObject({ path: z.string().optional(), kind: z.string().optional() })).optional(),
  message: z.string().optional(),
});

const CodexLine = z.looseObject({
  type: z.string(),
  item: CodexItem.optional(),
  message: z.string().optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
});

let codexSeq = 0;
const codexIds: Record<string, string> = {};

/** Codex items have no id on `started` lines in some versions: pair started/completed by command or tool text. */
function codexKey(item: z.infer<typeof CodexItem>): string {
  return item.id ?? `${item.type}:${item.command ?? item.tool ?? item.server ?? ""}`;
}

export function parseCodexLine(line: string): CliEvent[] {
  const parsed = CodexLine.safeParse(parseJson(line));
  if (!parsed.success) return [];
  const ev = parsed.data;
  if (ev.type === "error" && ev.message) return [{ type: "failure", message: ev.message }];
  if (ev.type === "turn.failed") return [{ type: "failure", message: ev.error?.message ?? "Codex reported an error." }];
  const item = ev.item;
  if (!item) return [];

  if (item.type === "agent_message") {
    return ev.type === "item.completed" && item.text ? [{ type: "text", text: item.text }] : [];
  }
  if (item.type === "reasoning") return [];

  const name =
    item.type === "command_execution"
      ? "shell"
      : item.type === "mcp_tool_call"
        ? (item.tool ?? "mcp")
        : item.type === "file_change"
          ? "edit"
          : item.type;
  const args: unknown = item.command ?? item.arguments ?? item.changes;
  if (ev.type === "item.started") {
    const id = `codex-${++codexSeq}`;
    codexIds[codexKey(item)] = id;
    return [{ type: "tool-start", id, name, args }];
  }
  if (ev.type === "item.completed") {
    const key = codexKey(item);
    const known = codexIds[key];
    const id = known ?? `codex-${++codexSeq}`;
    delete codexIds[key];
    const out: CliEvent[] = [];
    if (!known) out.push({ type: "tool-start", id, name, args });
    const failed = item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
    const detail = item.command ?? item.changes?.map((c) => c.path).filter(Boolean).join(", ") ?? item.tool ?? "";
    out.push({ type: "tool-result", id, ok: !failed, summary: clip(String(detail).replace(/\s+/g, " "), 120) });
    return out;
  }
  return [];
}

// ── OpenCode: run --format json ──────────────────────────────────────────────────────────

const OpenCodeLine = z.looseObject({
  type: z.string(),
  part: z
    .looseObject({
      type: z.string().optional(),
      text: z.string().optional(),
      tool: z.string().optional(),
      callID: z.string().optional(),
      state: z.looseObject({ status: z.string().optional(), input: z.unknown().optional(), output: z.string().optional(), title: z.string().optional(), error: z.string().optional() }).optional(),
    })
    .optional(),
  error: z.looseObject({ name: z.string().optional(), message: z.string().optional(), data: z.looseObject({ message: z.string().optional() }).optional() }).optional(),
});

export function parseOpenCodeLine(line: string): CliEvent[] {
  const parsed = OpenCodeLine.safeParse(parseJson(line));
  if (!parsed.success) return [];
  const ev = parsed.data;
  if (ev.type === "error") {
    const message = ev.error?.data?.message ?? ev.error?.message ?? ev.error?.name ?? "OpenCode reported an error.";
    return [{ type: "failure", message }];
  }
  const part = ev.part;
  if (!part) return [];
  if (ev.type === "text" && part.text) return [{ type: "text", text: part.text }];
  if (ev.type === "tool_use" && part.tool) {
    const id = part.callID ?? `oc-${++codexSeq}`;
    const failed = part.state?.status === "error";
    const detail = part.state?.title ?? part.state?.error ?? part.state?.output ?? "";
    return [
      { type: "tool-start", id, name: part.tool, args: part.state?.input },
      { type: "tool-result", id, ok: !failed, summary: clip(detail.replace(/\s+/g, " ").trim(), 120) },
    ];
  }
  return [];
}

export function parserFor(id: CliId): (line: string) => CliEvent[] {
  if (id === "claude") return parseClaudeLine;
  if (id === "codex") return parseCodexLine;
  return parseOpenCodeLine;
}

/** Tool names (as each CLI reports them) that change files in the project. */
const WRITERS: Record<string, true> = {
  Write: true,
  Edit: true,
  MultiEdit: true,
  NotebookEdit: true,
  shell: true,
  edit: true,
  apply_patch: true,
  write: true,
  patch: true,
  bash: true,
};

export function mayChangeFiles(name: string): boolean {
  return WRITERS[name] === true || name.startsWith("mcp__memotion__") || name.startsWith("memotion");
}
