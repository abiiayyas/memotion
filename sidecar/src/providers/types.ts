import { z } from "zod";

export const ProviderInput = z.object({
  /** Stable slug, also the keychain account name. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().min(1).max(60),
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 (no trailing /chat/completions). */
  baseURL: z.string().url(),
  /** Default model id sent in the `model` field. */
  model: z.string().min(1),
  /** Extra headers (e.g. OpenRouter's HTTP-Referer). Never put secrets here; use the key. */
  headers: z.record(z.string(), z.string()).default({}),
  capabilities: z
    .object({
      tools: z.boolean().default(true),
      vision: z.boolean().default(false),
      images: z.boolean().default(false),
    })
    .default({ tools: true, vision: false, images: false }),
});

export type ProviderConfig = z.infer<typeof ProviderInput>;

export interface ProviderPreset {
  presetId: string;
  name: string;
  baseURL: string;
  model: string;
  headers?: Record<string, string>;
  capabilities: ProviderConfig["capabilities"];
  /** Where to get a key; shown in the UI. */
  keyUrl?: string;
}

export interface ProviderView extends ProviderConfig {
  hasKey: boolean;
}
