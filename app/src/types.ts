export type Orientation = "landscape" | "portrait";

/** One item per shelf (visual style, hook, ...); a shelf without an entry is the director's choice. */
export type Picks = Record<string, string>;

export interface ShelfInfo {
  shelf: string;
  label: string;
  items: { id: string; name: string; description: string; builtIn: boolean }[];
}

export interface Project {
  id: string;
  name: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  updatedAt: string;
  brandKitId?: string;
  formatId?: string;
  skillId?: string;
  picks?: Picks;
}

/** A skill installed from a GitHub link; the director reads it before designing. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  /** A GitHub link or, for a folder import, the folder's path. */
  source: string;
  origin: "github" | "folder";
  files: string[];
  bytes: number;
  installedAt: string;
}

export interface ProviderCaps {
  tools: boolean;
  vision: boolean;
  images: boolean;
}

export interface Provider {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  imageModel?: string;
  headers: Record<string, string>;
  capabilities: ProviderCaps;
  hasKey: boolean;
}

export interface Preset {
  presetId: string;
  name: string;
  baseURL: string;
  model: string;
  headers?: Record<string, string>;
  capabilities: ProviderCaps;
  keyUrl?: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  toolCalling?: boolean;
}

export type MediaKind = "image" | "video" | "audio" | "font";

export interface Media {
  path: string;
  kind: MediaKind;
  bytes: number;
}

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; ok?: boolean; summary?: string };

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool-start"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; ok: boolean; summary: string }
  | { type: "files-changed" }
  | { type: "done" }
  | { type: "error"; message: string };

export interface RenderJob {
  id: string;
  projectId: string;
  status: "running" | "done" | "failed" | "cancelled";
  pct: number;
  stage: string;
  output?: string;
  outputPath?: string;
  error?: string;
}

export type Quality = "draft" | "standard" | "high";

export interface TimelineClip {
  ref: string;
  id: string;
  tag: string;
  trackKind: string;
  trackIndex: number;
  /** Local to the clip's own file; add `offset` for project time. */
  start: number;
  duration: number;
  end: number;
  absStart: number;
  absEnd: number;
  file: string;
  src: string | null;
  nested: boolean;
  host: string | null;
  offset: number;
  mediaStart: number | null;
  warnings: string[];
}

export interface TimelineView {
  duration: number;
  clips: TimelineClip[];
  canUndo: boolean;
  canRedo: boolean;
}

export type BatchEdit =
  | { verb: "move"; ref: string; start: number }
  | { verb: "trim"; ref: string; start?: number; end?: number }
  | { verb: "split"; ref: string; at: number }
  | { verb: "duplicate"; ref: string }
  | { verb: "delete"; ref: string };

export type EditOp =
  | { op: "batch"; edits: BatchEdit[] }
  | { op: "lane"; moves: { ref: string; track: number }[] }
  | { op: "move"; ref: string; start: number; overwrite?: boolean }
  | { op: "trim"; ref: string; start?: number; end?: number; overwrite?: boolean }
  | { op: "split"; ref: string; at: number }
  | { op: "duplicate"; ref: string }
  | { op: "delete"; ref: string }
  | { op: "length"; seconds: number };

export type EditResult = { ok: true } | { ok: false; reason: string; fix?: string };

export type VariableValue = string | number | boolean;

export interface Variable {
  id: string;
  type: "string" | "number" | "color" | "boolean" | "enum";
  label?: string;
  default: VariableValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  maxLength?: number;
  placeholder?: string;
  options?: { value: string; label?: string }[];
}

export interface FileVariables {
  file: string;
  variables: Variable[];
}

export interface VoiceOption {
  id: string;
  name: string;
  locale: string;
  gender?: string;
  provider: "edge" | "openai" | "gemini" | "elevenlabs" | "local";
}

export interface LocalTtsStatus {
  supported: boolean;
  engine: boolean;
  voices: Record<string, boolean>;
  voiceSizes: Record<string, number>;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface TtsRequest {
  text: string;
  provider: "edge" | "openai" | "gemini" | "elevenlabs" | "local";
  voice?: string;
  rate?: number;
}

export type CaptionStyle = "classic" | "highlight" | "pop" | "clean";

export interface CaptionRequest {
  style: CaptionStyle;
  position: "bottom" | "center" | "top";
  fontSize: number;
  fontFamily: string;
  primaryColor: string;
  accentColor: string;
  wordsPerGroup: number;
}

export type CaptionStyleName = "highlight" | "pop" | "classic" | "clean";

export interface BrandKit {
  id: string;
  name: string;
  colors: { primary: string; accent: string; background: string; text: string };
  fonts: { heading: string; body: string };
  notes: string;
  captionStyle: CaptionStyleName;
  logo?: string;
  customFonts: { family: string; file: string }[];
}

export interface Format {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  orientation?: Orientation;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  hasThumb: boolean;
}

export interface VariableFill {
  file: string;
  id: string;
  value: VariableValue;
}

export interface CaptureResult {
  dir: string;
  url: string;
  title: string;
  screenshots: string[];
  assets: string[];
  tokens: { colors: string[]; fonts: string[] };
  text: string;
  warnings: string[];
}

export interface RemotionFinding {
  severity: "blocker" | "warning" | "info";
  file: string;
  message: string;
}

export interface RemotionAnalysis {
  findings: RemotionFinding[];
  blocked: boolean;
  facts: { orientation: Orientation; fps: 30 | 60 };
  sourceFiles: number;
  compositions: string[];
  render: { ready: boolean; reason?: string };
}

export interface RemotionImport {
  project: Project;
  analysis: RemotionAnalysis;
  prompt: string;
}

export interface RemotionRender {
  project: Project;
  seconds: number;
  hasAudio: boolean;
}

export interface AppSettings {
  imageGeneration: boolean;
  /** Why image generation cannot run right now, or null when it can. */
  imageBlocker: string | null;
  reviewerProviderId: string | null;
  /** False when the chosen reviewer no longer works (deleted, lost its key, or no longer marked as able to see). */
  reviewerWorking: boolean;
  reviewerChoices: { id: string; name: string; model: string; hasKey: boolean }[];
}

/** Choices kept by the sidecar (preferences.json). Mirrors sidecar/src/preferences.ts. */
export interface Preferences {
  replyLanguage: "auto" | "id" | "en";
  maxSteps: number;
  maxReviews: number;
  maxImages: number;
  newVideoOrientation: "landscape" | "portrait";
  newVideoFps: 30 | 60;
  exportQuality: Quality;
  exportFps: "project" | "30" | "60";
  whisperModel: "auto" | "base" | "small" | "medium";
  voiceVendor: "edge" | "local" | "openai" | "gemini" | "elevenlabs";
  voiceId: string;
  voiceRate: number;
  captionsOn: boolean;
  captionStyle: CaptionStyle;
  captionPosition: "bottom" | "center" | "top";
}

export interface StorageItem {
  id: string;
  label: string;
  note: string;
  bytes: number;
}

export interface StorageInfo {
  dataDir: string;
  items: StorageItem[];
  projectsBytes: number;
  rendersBytes: number;
}

export interface AboutInfo {
  dataDir: string;
  hyperframes: string;
  gsap: string;
  gsapCached: boolean;
}

export type AgentBackend = "api" | "claude" | "codex" | "opencode";

export interface CliInfo {
  id: "claude" | "codex" | "opencode";
  label: string;
  vendor: string;
  found: boolean;
  path?: string;
  version?: string;
  signedIn: boolean | null;
  install: string;
  signInCommand: string;
}

export interface AgentsInfo {
  backend: AgentBackend;
  clis: CliInfo[];
}

// ── preview marks (select / draw / comment) ──────────────────────────────────────────────

/** What the preview page reports about an element. Coordinates are composition pixels. */
export interface Target {
  selector: string;
  id?: string | null;
  tag: string;
  classes: string[];
  text?: string | null;
  media?: string | null;
  rect: { x: number; y: number; w: number; h: number };
  compositionId?: string | null;
  compositionFile?: string | null;
  start?: string | null;
  duration?: string | null;
  styles: Record<string, string>;
}

export interface Selection {
  target: Target;
  time: number;
}

export interface DrawingAttachment {
  imagePath: string;
  note: string;
  hits: Target[];
  time: number;
  /** Small preview for the chat chip; never sent. */
  thumb: string;
}

export interface MarkComment {
  id: string;
  time: number;
  x: number;
  y: number;
  text: string;
  target?: Target;
  status: "open" | "sent";
  createdAt: string;
}

export interface ChatContext {
  selection?: Selection;
  drawing?: Omit<DrawingAttachment, "thumb">;
  commentIds?: string[];
}

export interface SystemCheck {
  name: "FFmpeg" | "FFprobe" | "Chrome";
  ok: boolean;
  detail: string;
  fix?: string;
}
