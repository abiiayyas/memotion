import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getApiKey, getImageProvider, isImageGenerationEnabled } from "../providers/store.js";
import type { ProviderConfig } from "../providers/types.js";
import { projectPath, touch, type Orientation } from "../projects/store.js";
import { assertPublicUrl } from "./netGuard.js";

export type ImageShape = "square" | Orientation;

/** DALL-E 3 and the gpt-image family accept different sizes; anything else gets the gpt-image sizes. */
export function imageSize(model: string, shape: ImageShape): string {
  const dalle3 = /dall-?e-?3/i.test(model);
  if (shape === "square") return "1024x1024";
  if (shape === "landscape") return dalle3 ? "1792x1024" : "1536x1024";
  return dalle3 ? "1024x1792" : "1024x1536";
}

const Response = z.object({
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })).min(1),
});

const MAX_IMAGE_BYTES = 30_000_000;

/** Identify the file type from its first bytes: the extension must match what the bytes are. */
export function sniffImage(bytes: Buffer): { ext: ".png" | ".jpg" | ".webp"; type: string } | null {
  if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: ".png", type: "image/png" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: ".jpg", type: "image/jpeg" };
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { ext: ".webp", type: "image/webp" };
  return null;
}

export interface GeneratedImage {
  /** Project-relative path. */
  path: string;
  provider: string;
  model: string;
}

async function requestImage(provider: ProviderConfig, apiKey: string, prompt: string, size: string, signal?: AbortSignal): Promise<Buffer> {
  const model = provider.imageModel ?? "";
  const res = await fetch(`${provider.baseURL.replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...provider.headers },
    // No `response_format`: gpt-image models reject it and always return base64; DALL-E answers with a URL.
    body: JSON.stringify({ model, prompt, size, n: 1 }),
    signal,
  });
  if (!res.ok) throw new Error(`Image request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const item = Response.parse(await res.json()).data[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    // The URL comes from the provider's answer; apply the same public-address rule as for website capture.
    const { url } = await assertPublicUrl(item.url);
    const img = await fetch(url, { signal, redirect: "error" });
    if (!img.ok) throw new Error(`Could not download the generated image (${img.status}).`);
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("The generated image is unexpectedly large.");
    return bytes;
  }
  throw new Error("The provider returned neither image data nor a URL.");
}

/** Reasons image generation cannot run, in the order the user can fix them. */
export function imageGenerationBlocker(): string | null {
  if (!isImageGenerationEnabled()) return "Image generation is switched off. The user can enable it in Settings; it costs money per image.";
  const p = getImageProvider();
  if (!p) return "No provider has an image model. Add one in Settings: tick \"Can generate images\" and set an image model (e.g. gpt-image-1).";
  if (!getApiKey(p.id)) return `No API key is saved for "${p.name}".`;
  return null;
}

export async function generateImage(
  projectId: string,
  opts: { prompt: string; shape: ImageShape; name?: string; size?: string },
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const blocker = imageGenerationBlocker();
  if (blocker) throw new Error(blocker);
  const provider = getImageProvider();
  const apiKey = provider ? getApiKey(provider.id) : null;
  if (!provider || !apiKey) throw new Error("No image provider is available.");

  const model = provider.imageModel ?? "";
  const bytes = await requestImage(provider, apiKey, opts.prompt, opts.size ?? imageSize(model, opts.shape), signal);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("The provider returned data that is not a PNG, JPEG or WebP image.");

  const base = (opts.name ?? opts.prompt).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "image";
  const dir = join(projectPath(projectId), "assets", "images");
  await mkdir(dir, { recursive: true });
  const file = `${base}-${randomBytes(2).toString("hex")}${kind.ext}`;
  await writeFile(join(dir, `.${file}.part`), bytes);
  await rename(join(dir, `.${file}.part`), join(dir, file));
  await touch(projectId);
  return { path: `assets/images/${file}`, provider: provider.name, model };
}
