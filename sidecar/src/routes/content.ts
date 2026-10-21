import { readFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { isAgentRunning } from "../agent/loop.js";
import { pickFonts, pickPalette } from "../brand/palette.js";
import {
  addFont,
  applyBrandKit,
  BrandKitInput,
  getBrandKit,
  listBrandKits,
  logoPath,
  removeBrandKit,
  removeFont,
  setLogo,
  upsertBrandKit,
} from "../brand/store.js";
import { getFormat, listFormats } from "../formats/store.js";
import { captureWebsite } from "../media/capture.js";
import { generateImage, imageGenerationBlocker } from "../media/images.js";
import { analyzeRemotionProject, importHyperframesProject, importRemotionProject } from "../projects/import.js";
import { projectPath, updateMeta } from "../projects/store.js";
import { isImageGenerationEnabled, setImageGenerationEnabled } from "../providers/store.js";
import { createFromTemplate, deleteTemplate, listTemplates, saveAsTemplate, templateVariables, thumbPath } from "../templates/store.js";

const BUSY = { ok: false, reason: "The director is working on this video. Wait for it to finish." } as const;

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif" };

async function sendImage(c: Context, file: string | null): Promise<Response> {
  if (!file) return c.json({ error: "not found" }, 404);
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return c.json({ error: "not found" }, 404);
  // The logo is user-supplied. SVG can carry script; serving it with a sandbox CSP keeps it an image only.
  return c.body(new Uint8Array(bytes), 200, {
    "Content-Type": IMAGE_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    "Cache-Control": "no-cache",
  });
}

const slug = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "kit";

export function registerContentRoutes(app: Hono): void {
  // ── brand kits ─────────────────────────────────────────────
  app.get("/brand-kits", async (c) => c.json(await listBrandKits()));
  app.put("/brand-kits/:id", async (c) => {
    const kit = BrandKitInput.parse(await c.req.json());
    if (kit.id !== c.req.param("id")) return c.json({ error: "id mismatch" }, 400);
    return c.json(await upsertBrandKit(kit));
  });
  app.delete("/brand-kits/:id", async (c) => {
    await removeBrandKit(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/brand-kits/:id/logo", async (c) => {
    const { path } = z.object({ path: z.string().min(1) }).parse(await c.req.json());
    return c.json(await setLogo(c.req.param("id"), path));
  });
  app.post("/brand-kits/:id/fonts", async (c) => {
    const body = z.object({ path: z.string().min(1), family: z.string().min(1).max(40) }).parse(await c.req.json());
    return c.json(await addFont(c.req.param("id"), body.path, body.family));
  });
  app.delete("/brand-kits/:id/fonts/:family", async (c) => c.json(await removeFont(c.req.param("id"), decodeURIComponent(c.req.param("family")))));
  // `/raw/` is the one path shape that accepts the token in the query, because <img> cannot send headers.
  app.get("/brand-kits/:id/raw/logo", async (c) => {
    const kit = await getBrandKit(c.req.param("id"));
    return sendImage(c, kit ? logoPath(kit) : null);
  });
  /** A starting kit from a captured website's colours and fonts; the user edits it afterwards. */
  app.post("/brand-kits/from-site", async (c) => {
    const body = z.object({ name: z.string().trim().min(1).max(60), colors: z.array(z.string()).max(40).default([]), fonts: z.array(z.string()).max(20).default([]) }).parse(await c.req.json());
    return c.json(
      await upsertBrandKit({
        id: `${slug(body.name)}-${randomBytes(2).toString("hex")}`,
        name: body.name,
        colors: pickPalette(body.colors),
        fonts: pickFonts(body.fonts),
        notes: "",
        captionStyle: "highlight",
      }),
    );
  });
  app.post("/projects/:id/brand", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json(BUSY, 409);
    const { kitId } = z.object({ kitId: z.string().nullable() }).parse(await c.req.json());
    if (kitId === null) {
      await rm(join(projectPath(id), "assets", "brand"), { recursive: true, force: true });
      await updateMeta(id, { brandKitId: undefined });
      return c.json({ ok: true });
    }
    await applyBrandKit(id, kitId);
    return c.json({ ok: true });
  });

  // ── formats ────────────────────────────────────────────────
  app.get("/formats", async (c) => c.json(await listFormats()));
  app.put("/projects/:id/format", async (c) => {
    const id = c.req.param("id");
    const { formatId } = z.object({ formatId: z.string().nullable() }).parse(await c.req.json());
    if (formatId !== null && !(await getFormat(formatId))) return c.json({ ok: false, reason: "Unknown format" }, 400);
    await updateMeta(id, { formatId: formatId ?? undefined });
    return c.json({ ok: true });
  });

  // ── templates ──────────────────────────────────────────────
  app.get("/templates", async (c) => c.json(await listTemplates()));
  app.delete("/templates/:id", async (c) => {
    await deleteTemplate(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/templates/:id/variables", async (c) => c.json(await templateVariables(c.req.param("id"))));
  app.get("/templates/:id/raw/thumb", async (c) => sendImage(c, thumbPath(c.req.param("id"))));
  app.post("/projects/:id/save-template", async (c) => {
    const body = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).default("") }).parse(await c.req.json());
    return c.json(await saveAsTemplate(c.req.param("id"), body.name, body.description));
  });
  app.post("/projects/from-template", async (c) => {
    const body = z
      .object({
        templateId: z.string(),
        name: z.string().trim().min(1).max(80),
        fills: z.array(z.object({ file: z.string(), id: z.string(), value: z.unknown() })).max(100).default([]),
      })
      .parse(await c.req.json());
    return c.json(await createFromTemplate(body.templateId, body.name, body.fills));
  });

  // ── importing projects ─────────────────────────────────────
  const ImportBody = z.object({ path: z.string().min(1), name: z.string().trim().max(80).optional() });
  app.post("/projects/import/hyperframes", async (c) => {
    const body = ImportBody.parse(await c.req.json());
    return c.json(await importHyperframesProject(body.path, body.name));
  });
  app.post("/projects/import/remotion/analyze", async (c) => c.json(await analyzeRemotionProject(ImportBody.parse(await c.req.json()).path)));
  app.post("/projects/import/remotion", async (c) => {
    const body = ImportBody.extend({ force: z.boolean().optional() }).parse(await c.req.json());
    return c.json(await importRemotionProject(body.path, body.name, { force: body.force }));
  });

  // ── website capture and generated images ───────────────────
  app.post("/projects/:id/capture", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json(BUSY, 409);
    const { url } = z.object({ url: z.string().min(1).max(2000) }).parse(await c.req.json());
    return c.json(await captureWebsite(id, url));
  });
  app.get("/settings", (c) => c.json({ imageGeneration: isImageGenerationEnabled(), imageBlocker: imageGenerationBlocker() }));
  app.put("/settings/image-generation", async (c) => {
    setImageGenerationEnabled(z.object({ enabled: z.boolean() }).parse(await c.req.json()).enabled);
    return c.json({ imageGeneration: isImageGenerationEnabled(), imageBlocker: imageGenerationBlocker() });
  });
  app.post("/projects/:id/images", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json(BUSY, 409);
    const body = z.object({ prompt: z.string().trim().min(3).max(4000), shape: z.enum(["square", "landscape", "portrait"]).default("landscape") }).parse(await c.req.json());
    return c.json(await generateImage(id, body));
  });
}
