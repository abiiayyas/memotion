import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { Entry } from "@napi-rs/keyring";
import { configPath } from "../config.js";
import { ProviderInput, type ProviderConfig, type ProviderView } from "./types.js";

const SERVICE = "memotion";

interface ConfigFile {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  /** Master switch for paid image generation. Off until the user turns it on. */
  imageGeneration: boolean;
}

function read(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) return { providers: [], activeProviderId: null, imageGeneration: false };
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ConfigFile>;
  return {
    providers: (raw.providers ?? []).map((p) => ProviderInput.parse(p)),
    activeProviderId: raw.activeProviderId ?? null,
    imageGeneration: raw.imageGeneration === true,
  };
}

export function isImageGenerationEnabled(): boolean {
  return read().imageGeneration;
}

export function setImageGenerationEnabled(on: boolean): void {
  write({ ...read(), imageGeneration: on });
}

/** The provider that will draw images: the active one if it can, else the first that can. */
export function getImageProvider(): ProviderConfig | undefined {
  const cfg = read();
  const can = (p: ProviderConfig): boolean => p.capabilities.images && Boolean(p.imageModel);
  const active = cfg.providers.find((p) => p.id === cfg.activeProviderId);
  return active && can(active) ? active : cfg.providers.find(can);
}

function write(cfg: ConfigFile): void {
  const path = configPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, path);
}

/** `MEMOTION_API_KEY_<ID>` wins over the keychain: lets scripts and CI run without a keychain. */
export function getApiKey(id: string): string | null {
  const fromEnv = process.env[`MEMOTION_API_KEY_${id.toUpperCase().replace(/-/g, "_")}`];
  if (fromEnv) return fromEnv;
  try {
    return new Entry(SERVICE, id).getPassword();
  } catch {
    return null;
  }
}

/** Save a key in the system keychain under `memotion/<id>`. Shared by every feature that uses the same vendor. */
export function setApiKey(id: string, apiKey: string): void {
  new Entry(SERVICE, id).setPassword(apiKey);
}

export function deleteApiKey(id: string): void {
  try {
    new Entry(SERVICE, id).deletePassword();
  } catch {
    // no keychain entry: nothing to delete
  }
}

export function listProviders(): { providers: ProviderView[]; activeProviderId: string | null } {
  const cfg = read();
  return {
    providers: cfg.providers.map((p) => ({ ...p, hasKey: getApiKey(p.id) !== null })),
    activeProviderId: cfg.activeProviderId,
  };
}

export function getProvider(id: string): ProviderConfig | undefined {
  return read().providers.find((p) => p.id === id);
}

export function getActiveProvider(): ProviderConfig | undefined {
  const cfg = read();
  return cfg.providers.find((p) => p.id === cfg.activeProviderId) ?? cfg.providers[0];
}

/** Create or replace a provider. The key is optional so editing metadata does not require re-entering it. */
export function upsertProvider(input: unknown, apiKey?: string): ProviderView {
  const provider = ProviderInput.parse(input);
  const cfg = read();
  const i = cfg.providers.findIndex((p) => p.id === provider.id);
  if (i >= 0) cfg.providers[i] = provider;
  else cfg.providers.push(provider);
  cfg.activeProviderId ??= provider.id;
  if (apiKey) new Entry(SERVICE, provider.id).setPassword(apiKey);
  write(cfg);
  return { ...provider, hasKey: getApiKey(provider.id) !== null };
}

export function removeProvider(id: string): void {
  const cfg = read();
  cfg.providers = cfg.providers.filter((p) => p.id !== id);
  if (cfg.activeProviderId === id) cfg.activeProviderId = cfg.providers[0]?.id ?? null;
  try {
    new Entry(SERVICE, id).deletePassword();
  } catch {
    // no keychain entry: nothing to delete
  }
  write(cfg);
}

export function setActiveProvider(id: string): void {
  const cfg = read();
  if (!cfg.providers.some((p) => p.id === id)) throw new Error(`Unknown provider: ${id}`);
  cfg.activeProviderId = id;
  write(cfg);
}
