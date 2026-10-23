import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runAgent, loadHistory, clearHistory, isAgentRunning } from "./agent/loop.js";
import { CLI_SPECS, detectClis } from "./agents/cli.js";
import { localizeGsap } from "./projects/gsap.js";
import { registerMcpRoutes } from "./agents/mcp.js";
import { ChatContext, markCommentsSent, renderContext } from "./marks/store.js";
import { registerPreviewProxy } from "./preview/proxy.js";
import { registerMarkRoutes } from "./routes/marks.js";
import { runCliAgent } from "./agents/run.js";
import { registerContentRoutes } from "./routes/content.js";
import { ensurePreview, stopPreview, withFreshPreview } from "./engine/preview.js";
import { EditOp, editTimeline, readTimeline, undoTimeline } from "./engine/timeline.js";
import { cancelJob, getJob, listJobs, renderEvents, startRender, type RenderJob } from "./engine/render.js";
import { listModels, testProvider } from "./providers/client.js";
import { PRESETS } from "./providers/presets.js";
import {
  listAllVoices,
  generateSpeechAndCaptions,
  transcribeAndCaption,
  LocalTranscriptionUnavailable,
  LocalTtsNotInstalled,
  LOCAL_VOICES,
  installLocalTts,
  localTtsStatus,
  CaptionRequest,
  TtsRequest,
} from "./audio/index.js";
import {
  deleteApiKey,
  getAgentBackend,
  getApiKey,
  getProvider,
  isAgentBackend,
  listProviders,
  removeProvider,
  setActiveProvider,
  setAgentBackend,
  setApiKey,
  upsertProvider,
} from "./providers/store.js";
import { ProviderInput } from "./providers/types.js";
import {
  createProject,
  deleteProject,
  importMedia,
  listFiles,
  listMedia,
  listProjects,
  projectPath,
  readMeta,
  renameProject,
  safeJoin,
} from "./projects/store.js";
import { readVariables, setVariable } from "./projects/variables.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
};

const CreateProject = z.object({
  name: z.string().trim().min(1).max(80),
  orientation: z.enum(["landscape", "portrait"]),
  fps: z.union([z.literal(30), z.literal(60)]).optional(),
});
const UpsertProvider = z.object({ provider: ProviderInput, apiKey: z.string().min(1).optional() });
const ChatBody = z.object({ message: z.string().trim().min(1).max(20_000), context: ChatContext.optional() });
const MediaBody = z.object({ paths: z.array(z.string().min(1)).min(1).max(50) });
const RenderBody = z.object({
  quality: z.enum(["draft", "standard", "high"]).optional(),
  fps: z.union([z.literal(30), z.literal(60)]).optional(),
});

export interface ServerOptions {
  token: string;
  /** Extra browser origins allowed to call the API (the Vite dev server). */
  extraOrigins?: string[];
  /** Log `METHOD path status ms` to stderr (query string dropped: it can carry the token). */
  logRequests?: boolean;
}

export function buildApp(opts: ServerOptions): Hono {
  const app = new Hono();
  const chatAborts = new Map<string, AbortController>();

  if (opts.logRequests) {
    app.use("*", async (c, next) => {
      const t0 = Date.now();
      await next();
      console.error(`[api] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - t0}ms`);
    });
  }

  app.use(
    "*",
    cors({
      origin: ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", ...(opts.extraOrigins ?? [])],
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // Loopback only, and a bearer token: a web page cannot guess it, and DNS rebinding fails the Host check.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const host = c.req.header("host") ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return c.json({ error: "bad host" }, 403);
    // Agent CLIs reach /mcp/<run token> and the preview iframe reaches /pv/<token>/...; neither can send a header.
    // Both carry their own credential in the path, which their handlers check.
    if (c.req.path.startsWith("/mcp/") || c.req.path.startsWith("/pv/")) return next();
    const bearer = c.req.header("authorization")?.replace(/^Bearer /, "");
    // <img>/<video> cannot send headers: raw file reads (GET only) may pass the token in the query.
    const queryToken = c.req.method === "GET" && c.req.path.includes("/raw/") ? c.req.query("token") : undefined;
    if ((bearer ?? queryToken) !== opts.token) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
    return c.json({ error: err.message }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ── providers ──────────────────────────────────────────────
  app.get("/presets", (c) => c.json(PRESETS));
  app.get("/providers", (c) => c.json(listProviders()));
  app.put("/providers/:id", async (c) => {
    const body = UpsertProvider.parse(await c.req.json());
    if (body.provider.id !== c.req.param("id")) return c.json({ error: "id mismatch" }, 400);
    return c.json(upsertProvider(body.provider, body.apiKey));
  });
  app.delete("/providers/:id", (c) => {
    removeProvider(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/providers/active", async (c) => {
    setActiveProvider(z.object({ id: z.string() }).parse(await c.req.json()).id);
    return c.json({ ok: true });
  });
  app.post("/providers/:id/test", async (c) => {
    const p = getProvider(c.req.param("id"));
    if (!p) return c.json({ error: "unknown provider" }, 404);
    return c.json(await testProvider(p));
  });
  app.get("/providers/:id/models", async (c) => {
    const p = getProvider(c.req.param("id"));
    if (!p) return c.json({ error: "unknown provider" }, 404);
    try {
      return c.json({ models: await listModels(p) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  // ── projects ───────────────────────────────────────────────
  app.get("/projects", async (c) => c.json(await listProjects()));
  app.post("/projects", async (c) => {
    const meta = await createProject(CreateProject.parse(await c.req.json()));
    await localizeGsap(meta.id).catch(() => []); // a new project starts able to work offline
    return c.json(meta);
  });
  app.get("/projects/:id", async (c) => c.json(await readMeta(c.req.param("id"))));
  app.patch("/projects/:id", async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json());
    return c.json(await renameProject(c.req.param("id"), name));
  });
  app.delete("/projects/:id", async (c) => {
    const id = c.req.param("id");
    // Files must not vanish under a running director or render: both would fail halfway and recreate stray folders.
    if (isAgentRunning(id)) return c.json({ error: "The director is working on this video. Stop it first, then delete." }, 409);
    if (listJobs(id).some((j) => j.status === "running")) return c.json({ error: "A render of this video is still running. Cancel it first, then delete." }, 409);
    // The preview server keeps running on a deleted folder otherwise.
    stopPreview(id);
    await deleteProject(id);
    return c.json({ ok: true });
  });
  app.get("/projects/:id/files", async (c) => c.json(await listFiles(c.req.param("id"))));
  app.get("/projects/:id/media", async (c) => c.json(await listMedia(c.req.param("id"))));
  app.post("/projects/:id/media", async (c) => {
    const { paths } = MediaBody.parse(await c.req.json());
    const imported = [];
    const failed: { path: string; error: string }[] = [];
    for (const p of paths) {
      try {
        imported.push(await importMedia(c.req.param("id"), p));
      } catch (err) {
        failed.push({ path: p, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return c.json({ imported, failed });
  });
  // The frame comes through our own proxy (see preview/proxy.ts), so the app can pick elements inside it.
  app.post("/projects/:id/preview", async (c) => {
    const id = c.req.param("id");
    const { port } = await ensurePreview(id);
    return c.json({ port, url: `http://${c.req.header("host")}/pv/${opts.token}/${id}/api/projects/${id}/preview` });
  });

  // Raw project file (thumbnails, finished renders). Range requests are needed for <video> seeking.
  app.get("/projects/:id/raw/*", async (c) => {
    const id = c.req.param("id");
    const rel = decodeURIComponent(c.req.path.split("/raw/")[1] ?? "");
    const abs = safeJoin(projectPath(id), rel);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) return c.json({ error: "not found" }, 404);
    const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) return c.body(null, 416, { "Content-Range": `bytes */${info.size}` });
      return c.body(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, 206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      });
    }
    return c.body(Readable.toWeb(createReadStream(abs)) as ReadableStream, 200, {
      "Content-Type": type,
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes",
    });
  });

  // ── chat ───────────────────────────────────────────────────
  app.get("/projects/:id/chat", async (c) => {
    const items = [];
    for (const m of await loadHistory(c.req.param("id"))) {
      if (m.role === "user" && typeof m.content === "string" && !m.content.startsWith("[snapshot")) {
        items.push({ kind: "user", text: m.content });
      } else if (m.role === "assistant") {
        if (typeof m.content === "string" && m.content) items.push({ kind: "assistant", text: m.content });
        for (const tc of m.tool_calls ?? []) {
          if (tc.type === "function") items.push({ kind: "tool", id: tc.id, name: tc.function.name });
        }
      }
    }
    return c.json(items);
  });
  app.delete("/projects/:id/chat", async (c) => {
    await clearHistory(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/projects/:id/chat/cancel", (c) => {
    chatAborts.get(c.req.param("id"))?.abort();
    return c.json({ ok: true });
  });
  // Who writes the video: an API provider, or a coding-agent CLI found on this computer.
  app.get("/agents", async (c) => c.json({ backend: getAgentBackend(), clis: await detectClis() }));
  app.get("/agents/backend", (c) => c.json({ backend: getAgentBackend() }));
  app.put("/agents/backend", async (c) => {
    const { backend, acceptRisk } = z.object({ backend: z.string().refine(isAgentBackend, "Unknown agent"), acceptRisk: z.boolean().optional() }).parse(await c.req.json());
    if (!isAgentBackend(backend)) return c.json({ error: "Unknown agent" }, 400);
    if (backend !== "api") {
      const cli = (await detectClis()).find((x) => x.id === backend);
      if (!cli?.found) return c.json({ error: `${CLI_SPECS[backend].label} was not found on this computer.` }, 400);
      // A tool that needs a safeguard turned off is only chosen when the user said yes to exactly that.
      if (CLI_SPECS[backend].risk && acceptRisk !== true) return c.json({ error: `${CLI_SPECS[backend].label} needs your confirmation first: ${CLI_SPECS[backend].risk}`, code: "risk_not_accepted" }, 409);
    }
    setAgentBackend(backend);
    return c.json({ backend });
  });
  app.post("/projects/:id/chat", async (c) => {
    const id = c.req.param("id");
    await readMeta(id); // 404-ish early failure for unknown ids
    const body = ChatBody.parse(await c.req.json());
    // Marks from the preview (selection, drawing, comments) travel with the message as text, and the drawing as an image.
    const rendered = body.context ? await renderContext(id, body.context) : { text: "", images: [] };
    const message = rendered.text ? `${body.message}\n\n${rendered.text}` : body.message;
    if (body.context?.commentIds?.length) await markCommentsSent(id, body.context.commentIds);
    const abort = new AbortController();
    chatAborts.set(id, abort);
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      try {
        const backend = getAgentBackend();
        const events = backend === "api" ? runAgent(id, message, abort.signal, rendered.images) : runCliAgent(id, message, abort.signal, backend);
        for await (const ev of events) {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } finally {
        chatAborts.delete(id);
      }
    });
  });

  // ── timeline & variables ───────────────────────────────────
  app.get("/projects/:id/timeline", async (c) => c.json(await readTimeline(c.req.param("id"))));
  app.post("/projects/:id/timeline/edit", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json({ ok: false, reason: "The director is working on this video. Wait for it to finish." }, 409);
    const op = EditOp.parse(await c.req.json());
    return c.json(await withFreshPreview(id, () => editTimeline(id, op)));
  });
  app.post("/projects/:id/timeline/:direction{undo|redo}", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json({ ok: false, reason: "The director is working on this video. Wait for it to finish." }, 409);
    const direction = c.req.param("direction") === "undo" ? "undo" : "redo";
    return c.json(await withFreshPreview(id, () => undoTimeline(id, direction)));
  });
  app.get("/projects/:id/variables", async (c) => c.json(await readVariables(c.req.param("id"))));
  app.put("/projects/:id/variables", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json({ ok: false, reason: "The director is working on this video. Wait for it to finish." }, 409);
    const body = z.object({ file: z.string(), id: z.string(), value: z.unknown() }).parse(await c.req.json());
    try {
      await withFreshPreview(id, () => setVariable(id, body.file, body.id, body.value));
      return c.json({ ok: true });
    } catch (err) {
      const reason = err instanceof z.ZodError ? (err.issues[0]?.message ?? "Invalid value") : err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, reason }, 400);
    }
  });

  // ── audio, voice & captions ────────────────────────────────
  app.get("/voices", async (c) => c.json({ voices: await listAllVoices() }));
  // Keys for voice vendors. OpenAI's is the same keychain entry as an OpenAI chat provider, so one key serves both.
  app.get("/tts-keys", (c) => c.json({ openai: getApiKey("openai") !== null, elevenlabs: getApiKey("elevenlabs") !== null }));
  app.put("/tts-keys/:vendor{openai|elevenlabs}", async (c) => {
    const { apiKey } = z.object({ apiKey: z.string().trim().min(8).max(300) }).parse(await c.req.json());
    setApiKey(c.req.param("vendor"), apiKey);
    return c.json({ ok: true });
  });
  // Only ElevenLabs can be removed here: removing "openai" would also break an OpenAI chat provider.
  app.delete("/tts-keys/elevenlabs", (c) => {
    deleteApiKey("elevenlabs");
    return c.json({ ok: true });
  });
  // Offline voices: nothing is downloaded until the user asks for it here.
  app.get("/tts-local", (c) => c.json({ ...localTtsStatus(), voiceSizes: Object.fromEntries(Object.entries(LOCAL_VOICES).map(([id, v]) => [id, v.megabytes])) }));
  app.post("/tts-local/install", async (c) => {
    const { voice } = z.object({ voice: z.string().refine((v) => v in LOCAL_VOICES, "Unknown voice") }).parse(await c.req.json());
    try {
      await installLocalTts(voice);
      return c.json({ ok: true, ...localTtsStatus() });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  app.post("/projects/:id/tts", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json({ ok: false, reason: "The director is working on this video. Wait for it to finish." }, 409);
    const body = z
      .object({
        tts: TtsRequest,
        caption: CaptionRequest.optional(),
      })
      .parse(await c.req.json());
    try {
      const res = await withFreshPreview(id, () => generateSpeechAndCaptions(id, body.tts, body.caption));
      return c.json({ ok: true, ...res });
    } catch (err) {
      if (err instanceof LocalTtsNotInstalled) return c.json({ ok: false, code: "local_tts_unavailable", voice: err.voice, error: err.message }, 422);
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  app.post("/projects/:id/transcribe", async (c) => {
    const id = c.req.param("id");
    if (isAgentRunning(id)) return c.json({ ok: false, reason: "The director is working on this video. Wait for it to finish." }, 409);
    const body = z
      .object({
        mediaPath: z.string().min(1),
        caption: CaptionRequest.default({
          style: "highlight",
          position: "bottom",
          fontSize: 64,
          fontFamily: "Inter",
          primaryColor: "#ffffff",
          accentColor: "#ff9d6b",
          wordsPerGroup: 3,
        }),
        language: z.string().min(2).max(8).optional(),
        model: z.enum(["base", "small", "medium", "base.en", "small.en", "medium.en"]).optional(),
        /** Explicit consent to install whisper-cpp and download a model. */
        allowInstall: z.boolean().optional(),
      })
      .parse(await c.req.json());
    try {
      const res = await withFreshPreview(id, () =>
        transcribeAndCaption(id, body.mediaPath, body.caption, { language: body.language, model: body.model, allowInstall: body.allowInstall }),
      );
      return c.json({ ok: true, ...res });
    } catch (err) {
      if (err instanceof LocalTranscriptionUnavailable) return c.json({ ok: false, code: "local_unavailable", error: err.message }, 422);
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  // ── render ─────────────────────────────────────────────────
  app.post("/projects/:id/render", async (c) =>
    c.json(await startRender(c.req.param("id"), RenderBody.parse(await c.req.json().catch(() => ({}))))),
  );
  app.get("/projects/:id/renders", (c) => c.json(listJobs(c.req.param("id"))));
  app.delete("/renders/:job", (c) => {
    cancelJob(c.req.param("job"));
    return c.json({ ok: true });
  });
  app.get("/renders/:job/events", (c) => {
    const jobId = c.req.param("job");
    const current = getJob(jobId);
    if (!current) return c.json({ error: "unknown job" }, 404);
    return streamSSE(c, async (stream) => {
      const { promise: closed, resolve: close } = Promise.withResolvers<void>();
      const send = async (job: RenderJob) => {
        await stream.writeSSE({ event: "progress", data: JSON.stringify(job) });
        if (job.status !== "running") close();
      };
      renderEvents.on(jobId, send);
      stream.onAbort(close);
      await send(current);
      await closed;
      renderEvents.off(jobId, send);
    });
  });

  registerContentRoutes(app);
  registerMcpRoutes(app);
  registerPreviewProxy(app, opts.token);
  registerMarkRoutes(app);

  return app;
}
