import OpenAI from "openai";
import { getApiKey } from "./store.js";
import type { ProviderConfig } from "./types.js";

/** One OpenAI SDK client per call: provider settings can change between requests. */
export function makeClient(provider: ProviderConfig): OpenAI {
  const apiKey = getApiKey(provider.id);
  if (!apiKey) throw new Error(`No API key saved for provider "${provider.name}".`);
  return new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.headers,
    maxRetries: 2,
    timeout: 120_000,
  });
}

export async function listModels(provider: ProviderConfig): Promise<string[]> {
  const page = await makeClient(provider).models.list();
  return page.data.map((m) => m.id).sort();
}

export interface TestResult {
  ok: boolean;
  /** Reply text on success, a human-readable reason on failure. */
  message: string;
  toolCalling?: boolean;
}

/**
 * Two probes: a plain completion (key, URL and model are valid), then a forced tool call
 * (the agent cannot work without it). A provider that fails only the second still saves, flagged tools=false.
 */
export async function testProvider(provider: ProviderConfig): Promise<TestResult> {
  try {
    const client = makeClient(provider);
    const res = await client.chat.completions.create({
      model: provider.model,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 16,
    });
    const text = res.choices[0]?.message.content?.trim() ?? "";
    let toolCalling = false;
    try {
      const t = await client.chat.completions.create({
        model: provider.model,
        messages: [{ role: "user", content: "Call the ping tool." }],
        tools: [
          {
            type: "function",
            function: { name: "ping", description: "Returns pong", parameters: { type: "object", properties: {} } },
          },
        ],
        tool_choice: "required",
        max_tokens: 64,
      });
      toolCalling = (t.choices[0]?.message.tool_calls?.length ?? 0) > 0;
    } catch {
      toolCalling = false;
    }
    return { ok: true, message: text || "(empty reply)", toolCalling };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
