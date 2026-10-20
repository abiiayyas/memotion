export type Orientation = "landscape" | "portrait";

export interface Project {
  id: string;
  name: string;
  orientation: Orientation;
  fps: 30 | 60;
  createdAt: string;
  updatedAt: string;
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
  provider: "edge" | "openai" | "elevenlabs";
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface TtsRequest {
  text: string;
  provider: "edge" | "openai" | "elevenlabs";
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
