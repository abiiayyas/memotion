import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import { makeClient } from "../providers/client.js";
import { buildBrief } from "./brief.js";
import { getActiveProvider } from "../providers/store.js";
import { previewEtag, waitPreviewChanged } from "../engine/preview.js";
import { listMedia, projectPath, readMeta } from "../projects/store.js";
import { systemPrompt } from "./prompt.js";
import { runTool, TOOL_SPECS } from "./tools.js";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-start"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; ok: boolean; summary: string }
  | { type: "files-changed" }
  | { type: "done" }
  | { type: "error"; message: string };

/** Tool rounds one user message may take. A real video (docs, scenes, fixes) used all of 30 in a measured DeepSeek run. */
const MAX_ROUNDS = 60;
/** Sent once, only for the next request and never stored, when the model wants to finish without having checked its work. */
export const CHECK_REMINDER =
  "Automatic reminder: you changed files but did not run `check` afterwards. Run `check` now, fix every error it reports, then finish with your summary.";
/** Paid images one user message may trigger. A confused or manipulated model must not be able to run up a bill. */
const MAX_IMAGES_PER_TURN = 4;
/** Tool output from earlier turns is cut to this when re-sent, to keep long sessions inside the context window. */
const OLD_TOOL_CHARS = 2_000;
const IMAGES_OMITTED = "[snapshot images omitted from history]";

const running = new Set<string>();

/** Timeline edits are refused while the agent is writing the same files. */
export function isAgentRunning(projectId: string): boolean {
  return running.has(projectId);
}

const StoredHistory = z.array(z.custom<ChatCompletionMessageParam>((v) => typeof v === "object" && v !== null && "role" in v));

function historyFile(projectId: string): string {
  return join(projectPath(projectId), ".memotion", "chat.json");
}

export async function loadHistory(projectId: string): Promise<ChatCompletionMessageParam[]> {
  try {
    return StoredHistory.parse(JSON.parse(await readFile(historyFile(projectId), "utf8")));
  } catch {
    return [];
  }
}

async function saveHistory(projectId: string, messages: ChatCompletionMessageParam[]): Promise<void> {
  const file = historyFile(projectId);
  await mkdir(join(file, ".."), { recursive: true });
  // Snapshots are ephemeral: persisting base64 PNGs would bloat the file and every later request.
  const slim = messages.map((m) =>
    m.role === "user" && Array.isArray(m.content) ? { ...m, content: IMAGES_OMITTED } : m,
  );
  const tmp = `${file}.part`;
  await writeFile(tmp, JSON.stringify(slim));
  await rename(tmp, file);
}

export async function clearHistory(projectId: string): Promise<void> {
  await saveHistory(projectId, []);
}

/** Messages as sent to the model: older tool results truncated, current turn untouched. */
function forSend(messages: ChatCompletionMessageParam[], turnStart: number): ChatCompletionMessageParam[] {
  return messages.map((m, i) =>
    i < turnStart && m.role === "tool" && typeof m.content === "string" && m.content.length > OLD_TOOL_CHARS
      ? { ...m, content: `${m.content.slice(0, OLD_TOOL_CHARS)}\n…[older output truncated]` }
      : m,
  );
}

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * One user turn: stream the model, run its tool calls, feed results back, repeat until it answers in text.
 * History is committed per round so an abort or error never leaves an assistant tool_call without its results.
 */
export async function* runAgent(projectId: string, userText: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  if (running.has(projectId)) {
    yield { type: "error", message: "The agent is already working on this project." };
    return;
  }
  running.add(projectId);
  try {
    const provider = getActiveProvider();
    if (!provider) {
      yield { type: "error", message: "No AI provider configured. Add one in Settings." };
      return;
    }
    const client = makeClient(provider);
    const meta = await readMeta(projectId);
    const messages = await loadHistory(projectId);
    const turnStart = messages.length;
    const imageBudget = { left: MAX_IMAGES_PER_TURN };
    messages.push({ role: "user", content: userText });
    await saveHistory(projectId, messages);

    let checkedSinceChange = true;
    let reminder = false;
    let reminded = false;
    let finished = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) break;
      const media = (await listMedia(projectId)).map((m) => `${m.path} (${m.kind})`);
      // Re-read the project each round: the user may switch brand kit or format between turns.
      const brief = await buildBrief(await readMeta(projectId));
      const stream = await client.chat.completions.create(
        {
          model: provider.model,
          stream: true,
          messages: [{ role: "system", content: systemPrompt(meta, media, brief) }, ...forSend(messages, turnStart), ...(reminder ? [{ role: "user" as const, content: CHECK_REMINDER }] : [])],
          ...(provider.capabilities.tools ? { tools: TOOL_SPECS } : {}),
        },
        { signal },
      );

      let text = "";
      const calls: PartialCall[] = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          yield { type: "text", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }

      const done = calls.filter((c) => c.name);
      reminder = false;
      if (done.length === 0) {
        // Weaker models skip verification however the prompt words it. Ask once; the draft answer is not kept.
        if (!checkedSinceChange && !reminded) {
          reminded = true;
          reminder = true;
          continue;
        }
        messages.push({ role: "assistant", content: text });
        finished = true;
        break;
      }

      const toolCalls: ChatCompletionMessageToolCall[] = done.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: "function",
        function: { name: c.name, arguments: c.args || "{}" },
      }));
      const previewBefore = await previewEtag(projectId);
      const results: ChatCompletionMessageParam[] = [];
      const images: Buffer[] = [];
      let changed = false;

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          results.push({ role: "tool", tool_call_id: call.id, content: "Error: tool arguments were not valid JSON. Retry." });
          yield { type: "tool-result", id: call.id, ok: false, summary: "invalid arguments" };
          continue;
        }
        yield { type: "tool-start", id: call.id, name: call.function.name, args };
        if (signal.aborted) {
          results.push({ role: "tool", tool_call_id: call.id, content: "Cancelled by the user." });
          continue;
        }
        const out = await runTool(projectId, call.function.name, args, { signal, vision: provider.capabilities.vision, imageBudget });
        results.push({ role: "tool", tool_call_id: call.id, content: out.content });
        if (out.images) images.push(...out.images);
        changed ||= out.changed === true;
        if (call.function.name === "check") checkedSinceChange = true;
        else if (out.changed === true) checkedSinceChange = false;
        yield { type: "tool-result", id: call.id, ok: out.ok, summary: out.summary };
      }

      messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls }, ...results);
      if (images.length) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: "Snapshots you requested:" },
            ...images.map((b) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/png;base64,${b.toString("base64")}` },
            })),
          ],
        });
      }
      if (changed) {
        // Reloading the preview before the Studio has seen the writes would leave it showing the previous version.
        await waitPreviewChanged(projectId, previewBefore);
        yield { type: "files-changed" };
      }
      await saveHistory(projectId, messages);
    }
    await saveHistory(projectId, messages);
    if (!finished && !signal.aborted) {
      yield { type: "error", message: `The director stopped after ${MAX_ROUNDS} steps before finishing. Send "continue" to let it carry on.` };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: signal.aborted ? "Cancelled." : err instanceof Error ? err.message : String(err) };
  } finally {
    running.delete(projectId);
  }
}
