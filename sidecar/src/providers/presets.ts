import type { ProviderPreset } from "./types.js";

/**
 * Starting points only. Every field stays editable, and "custom" is the escape hatch for any
 * OpenAI-compatible endpoint. Base URLs verified against each vendor's docs; model ids drift,
 * so the UI can list live models from `GET {baseURL}/models` instead.
 */
export const PRESETS: ProviderPreset[] = [
  {
    presetId: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1",
    capabilities: { tools: true, vision: true, images: true },
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    presetId: "anthropic",
    name: "Anthropic (Claude)",
    baseURL: "https://api.anthropic.com/v1/",
    model: "claude-sonnet-4-5",
    capabilities: { tools: true, vision: true, images: false },
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    presetId: "gemini",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-2.5-pro",
    capabilities: { tools: true, vision: true, images: false },
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    presetId: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-chat",
    capabilities: { tools: true, vision: false, images: false },
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    presetId: "grok",
    name: "xAI Grok",
    baseURL: "https://api.x.ai/v1",
    model: "grok-4",
    capabilities: { tools: true, vision: true, images: false },
    keyUrl: "https://console.x.ai",
  },
  {
    presetId: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.5",
    headers: { "X-Title": "Memotion" },
    capabilities: { tools: true, vision: true, images: false },
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    presetId: "opencode",
    name: "OpenCode Zen",
    baseURL: "https://opencode.ai/zen/v1",
    model: "",
    capabilities: { tools: true, vision: false, images: false },
    keyUrl: "https://opencode.ai/zen",
  },
  {
    presetId: "commandcode",
    name: "Command Code",
    baseURL: "https://api.commandcode.ai/provider/v1",
    model: "",
    capabilities: { tools: true, vision: false, images: false },
    keyUrl: "https://commandcode.ai/docs/provider",
  },
  {
    presetId: "custom",
    name: "Custom OpenAI-compatible",
    baseURL: "",
    model: "",
    capabilities: { tools: true, vision: false, images: false },
  },
];
