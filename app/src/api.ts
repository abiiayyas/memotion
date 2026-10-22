import { invoke } from "@tauri-apps/api/core";
import type {
  CaptionRequest,
  TtsRequest,
  AgentBackend,
  AgentsInfo,
  ChatContext,
  LocalTtsStatus,
  SystemCheck,
  MarkComment,
  Target,
  VoiceOption,
  WordTiming,
  AgentEvent,
  EditOp,
  EditResult,
  FileVariables,
  ChatItem,
  Media,
  Orientation,
  Preset,
  Project,
  Provider,
  Quality,
  RenderJob,
  TestResult,
  TimelineView,
  VariableValue,
  AppSettings,
  BrandKit,
  CaptureResult,
  FileVariables as TemplateVariables,
  Format,
  RemotionAnalysis,
  RemotionImport,
  TemplateInfo,
  VariableFill,
} from "./types";

export interface Connection {
  base: string;
  token: string;
}

let conn: Connection | null = null;

const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * In the desktop shell the Rust side owns the sidecar and reports its port and token.
 * In a plain browser (vite dev) pass `?sidecar=<port>&token=<token>` once; it is remembered for the session.
 */
export async function connect(): Promise<Connection> {
  if (conn) return conn;
  if (inTauri) {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const info = await invoke<{ port: number; token: string } | null>("sidecar_info");
      if (info) return (conn = { base: `http://127.0.0.1:${info.port}`, token: info.token });
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("The background service did not start within 40 s.");
  }
  const q = new URLSearchParams(location.search);
  const port = q.get("sidecar") ?? sessionStorage.getItem("memotion.port");
  const token = q.get("token") ?? sessionStorage.getItem("memotion.token");
  if (!port || !token) throw new Error("Open with ?sidecar=<port>&token=<token> when running outside Tauri.");
  sessionStorage.setItem("memotion.port", port);
  sessionStorage.setItem("memotion.token", token);
  return (conn = { base: `http://127.0.0.1:${port}`, token });
}

function auth(c: Connection): Record<string, string> {
  return { Authorization: `Bearer ${c.token}` };
}

/** A failed request, keeping the machine-readable `code` some endpoints add (e.g. `local_unavailable`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const c = await connect();
  const res = await fetch(`${c.base}${path}`, {
    method,
    headers: { ...auth(c), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : data && typeof data === "object" && "reason" in data
          ? String(data.reason)
          : `HTTP ${res.status}`;
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined;
    throw new ApiError(msg, res.status, code);
  }
  return data as T;
}

/** URL for an <img>/<video> src: the token rides in the query because those elements cannot send headers. */
export async function rawUrl(projectId: string, path: string): Promise<string> {
  const c = await connect();
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${c.base}/projects/${projectId}/raw/${encoded}?token=${c.token}`;
}

/** `<img>` URL for a brand kit's logo. The query string busts the cache after the logo is replaced. */
export async function brandLogoUrl(kitId: string, version: string): Promise<string> {
  const c = await connect();
  return `${c.base}/brand-kits/${kitId}/raw/logo?token=${c.token}&v=${encodeURIComponent(version)}`;
}

export async function templateThumbUrl(templateId: string): Promise<string> {
  const c = await connect();
  return `${c.base}/templates/${templateId}/raw/thumb?token=${c.token}`;
}

/** Parse a fetch() SSE body into (event, data) pairs. EventSource cannot send the Authorization header. */
async function* sse(res: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

export const api = {
  presets: () => request<Preset[]>("GET", "/presets"),
  providers: () => request<{ providers: Provider[]; activeProviderId: string | null }>("GET", "/providers"),
  saveProvider: (provider: Omit<Provider, "hasKey">, apiKey?: string) =>
    request<Provider>("PUT", `/providers/${provider.id}`, { provider, apiKey }),
  deleteProvider: (id: string) => request<{ ok: true }>("DELETE", `/providers/${id}`),
  setActiveProvider: (id: string) => request<{ ok: true }>("POST", "/providers/active", { id }),
  testProvider: (id: string) => request<TestResult>("POST", `/providers/${id}/test`),
  models: (id: string) => request<{ models: string[] }>("GET", `/providers/${id}/models`),

  projects: () => request<Project[]>("GET", "/projects"),
  createProject: (name: string, orientation: Orientation, fps: 30 | 60) =>
    request<Project>("POST", "/projects", { name, orientation, fps }),
  renameProject: (id: string, name: string) => request<Project>("PATCH", `/projects/${id}`, { name }),
  deleteProject: (id: string) => request<{ ok: true }>("DELETE", `/projects/${id}`),
  media: (id: string) => request<Media[]>("GET", `/projects/${id}/media`),
  importMedia: (id: string, paths: string[]) =>
    request<{ imported: Media[]; failed: { path: string; error: string }[] }>("POST", `/projects/${id}/media`, { paths }),
  preview: (id: string) => request<{ port: number; url: string }>("POST", `/projects/${id}/preview`),

  timeline: (id: string) => request<TimelineView>("GET", `/projects/${id}/timeline`),
  editTimeline: (id: string, op: EditOp) => request<EditResult>("POST", `/projects/${id}/timeline/edit`, op),
  undoTimeline: (id: string, direction: "undo" | "redo") => request<EditResult>("POST", `/projects/${id}/timeline/${direction}`),
  variables: (id: string) => request<FileVariables[]>("GET", `/projects/${id}/variables`),
  setVariable: (id: string, file: string, variable: string, value: VariableValue) =>
    request<EditResult>("PUT", `/projects/${id}/variables`, { file, id: variable, value }),

  voices: () => request<{ voices: VoiceOption[] }>("GET", "/voices"),
  comments: (id: string) => request<MarkComment[]>("GET", `/projects/${id}/comments`),
  addComment: (id: string, c: { time: number; x: number; y: number; text: string; target?: Target }) => request<MarkComment>("POST", `/projects/${id}/comments`, c),
  deleteComment: (id: string, commentId: string) => request<{ ok: true }>("DELETE", `/projects/${id}/comments/${commentId}`),
  agents: () => request<AgentsInfo>("GET", "/agents"),
  agentBackend: () => request<{ backend: AgentBackend }>("GET", "/agents/backend"),
  setAgentBackend: (backend: AgentBackend) => request<{ backend: AgentBackend }>("PUT", "/agents/backend", { backend }),
  localTts: () => request<LocalTtsStatus>("GET", "/tts-local"),
  installLocalTts: (voice: string) => request<LocalTtsStatus & { ok: true }>("POST", "/tts-local/install", { voice }),
  generateSpeech: (projectId: string, tts: TtsRequest, caption?: CaptionRequest) =>
    request<{ ok: boolean; audioPath: string; duration: number; words: WordTiming[]; captionsFile?: string; timingEstimated: boolean }>(
      "POST",
      `/projects/${projectId}/tts`,
      { tts, caption },
    ),
  transcribeMedia: (projectId: string, mediaPath: string, caption?: CaptionRequest, opts: { language?: string; allowInstall?: boolean } = {}) =>
    request<{ ok: boolean; captionsFile: string; duration: number; words: WordTiming[] }>(
      "POST",
      `/projects/${projectId}/transcribe`,
      { mediaPath, caption, language: opts.language, allowInstall: opts.allowInstall },
    ),

  ttsKeys: () => request<{ openai: boolean; elevenlabs: boolean }>("GET", "/tts-keys"),
  saveTtsKey: (vendor: "openai" | "elevenlabs", apiKey: string) => request<{ ok: true }>("PUT", `/tts-keys/${vendor}`, { apiKey }),
  removeElevenLabsKey: () => request<{ ok: true }>("DELETE", "/tts-keys/elevenlabs"),

  brandKits: () => request<BrandKit[]>("GET", "/brand-kits"),
  saveBrandKit: (kit: Omit<BrandKit, "logo" | "customFonts">) => request<BrandKit>("PUT", `/brand-kits/${kit.id}`, kit),
  deleteBrandKit: (id: string) => request<{ ok: true }>("DELETE", `/brand-kits/${id}`),
  setBrandLogo: (id: string, path: string) => request<BrandKit>("POST", `/brand-kits/${id}/logo`, { path }),
  addBrandFont: (id: string, path: string, family: string) => request<BrandKit>("POST", `/brand-kits/${id}/fonts`, { path, family }),
  removeBrandFont: (id: string, family: string) => request<BrandKit>("DELETE", `/brand-kits/${id}/fonts/${encodeURIComponent(family)}`),
  brandFromSite: (name: string, colors: string[], fonts: string[]) => request<BrandKit>("POST", "/brand-kits/from-site", { name, colors, fonts }),
  applyBrand: (projectId: string, kitId: string | null) => request<{ ok: true }>("POST", `/projects/${projectId}/brand`, { kitId }),

  formats: () => request<Format[]>("GET", "/formats"),
  setFormat: (projectId: string, formatId: string | null) => request<{ ok: true }>("PUT", `/projects/${projectId}/format`, { formatId }),

  templates: () => request<TemplateInfo[]>("GET", "/templates"),
  deleteTemplate: (id: string) => request<{ ok: true }>("DELETE", `/templates/${id}`),
  templateVariables: (id: string) => request<TemplateVariables[]>("GET", `/templates/${id}/variables`),
  saveTemplate: (projectId: string, name: string, description: string) => request<TemplateInfo>("POST", `/projects/${projectId}/save-template`, { name, description }),
  createFromTemplate: (templateId: string, name: string, fills: VariableFill[]) => request<Project>("POST", "/projects/from-template", { templateId, name, fills }),

  importHyperframes: (path: string, name?: string) => request<Project>("POST", "/projects/import/hyperframes", { path, name }),
  analyzeRemotion: (path: string) => request<RemotionAnalysis>("POST", "/projects/import/remotion/analyze", { path }),
  importRemotion: (path: string, name: string | undefined, force: boolean) => request<RemotionImport>("POST", "/projects/import/remotion", { path, name, force }),

  capture: (projectId: string, url: string) => request<CaptureResult>("POST", `/projects/${projectId}/capture`, { url }),
  settings: () => request<AppSettings>("GET", "/settings"),
  system: () => request<{ checks: SystemCheck[] }>("GET", "/system"),
  downloadChrome: () => request<{ checks: SystemCheck[] }>("POST", "/system/chrome"),
  setReviewer: (providerId: string | null) => request<AppSettings>("PUT", "/settings/reviewer", { providerId }),
  setImageGeneration: (enabled: boolean) => request<AppSettings>("PUT", "/settings/image-generation", { enabled }),
  generateImage: (projectId: string, prompt: string, shape: "square" | "landscape" | "portrait") => request<{ path: string }>("POST", `/projects/${projectId}/images`, { prompt, shape }),

  history: (id: string) => request<ChatItem[]>("GET", `/projects/${id}/chat`),
  clearHistory: (id: string) => request<{ ok: true }>("DELETE", `/projects/${id}/chat`),
  cancelChat: (id: string) => request<{ ok: true }>("POST", `/projects/${id}/chat/cancel`),

  startRender: (id: string, opts: { quality: Quality; fps: 30 | 60 }) =>
    request<RenderJob>("POST", `/projects/${id}/render`, opts),
  cancelRender: (job: string) => request<{ ok: true }>("DELETE", `/renders/${job}`),
};

/** Send a chat message and yield agent events as they stream in. Aborting `signal` cancels the run. */
export async function* chat(projectId: string, message: string, signal: AbortSignal, context?: ChatContext): AsyncGenerator<AgentEvent> {
  const c = await connect();
  const res = await fetch(`${c.base}/projects/${projectId}/chat`, {
    method: "POST",
    headers: { ...auth(c), "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
    signal,
  });
  for await (const { data } of sse(res)) yield JSON.parse(data) as AgentEvent;
}

export async function* renderProgress(jobId: string, signal: AbortSignal): AsyncGenerator<RenderJob> {
  const c = await connect();
  const res = await fetch(`${c.base}/renders/${jobId}/events`, { headers: auth(c), signal });
  for await (const { data } of sse(res)) yield JSON.parse(data) as RenderJob;
}

/** The frame at `seconds` as a PNG, rendered by the sidecar (takes a few seconds). */
export async function fetchFrame(projectId: string, seconds: number, signal?: AbortSignal): Promise<Blob> {
  const c = await connect();
  const res = await fetch(`${c.base}/projects/${projectId}/frame?t=${encodeURIComponent(String(seconds))}`, { headers: auth(c), signal });
  if (!res.ok) throw new ApiError(`Could not capture the frame (HTTP ${res.status})`, res.status);
  return res.blob();
}

/** Store a PNG for the next message to the director; returns its project-relative path. */
export async function uploadMarkImage(projectId: string, png: Blob): Promise<string> {
  const c = await connect();
  const res = await fetch(`${c.base}/projects/${projectId}/marks/image`, { method: "POST", headers: { ...auth(c), "Content-Type": "image/png" }, body: png });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== "object" || !("path" in data) || typeof data.path !== "string") {
    throw new ApiError(data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`, res.status);
  }
  return data.path;
}
