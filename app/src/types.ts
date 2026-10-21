export type Orientation = "landscape" | "portrait";

export interface Project {
  id: string;
  name: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  updatedAt: string;
  brandKitId?: string;
  formatId?: string;
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

export type EditOp =
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
  provider: "edge" | "openai" | "elevenlabs" | "local";
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
  provider: "edge" | "openai" | "elevenlabs" | "local";
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
}

export interface RemotionImport {
  project: Project;
  analysis: RemotionAnalysis;
  prompt: string;
}

export interface AppSettings {
  imageGeneration: boolean;
  /** Why image generation cannot run right now, or null when it can. */
  imageBlocker: string | null;
}

export type AgentBackend = "api" | "claude" | "codex" | "opencode";

export interface CliInfo {
  id: "claude" | "codex" | "opencode" | "agy";
  label: string;
  vendor: string;
  found: boolean;
  path?: string;
  version?: string;
  signedIn: boolean | null;
  unsupported?: string;
  install: string;
  signInCommand: string;
}

export interface AgentsInfo {
  backend: AgentBackend;
  clis: CliInfo[];
}
