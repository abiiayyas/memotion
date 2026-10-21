import { z } from "zod";

export const WordTiming = z.object({
  text: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
});
export type WordTiming = z.infer<typeof WordTiming>;

export interface VoiceOption {
  id: string;
  name: string;
  locale: string;
  gender?: string;
  provider: "edge" | "openai" | "elevenlabs" | "local";
}

export const TtsRequest = z.object({
  text: z.string().min(1).max(10_000),
  provider: z.enum(["edge", "openai", "elevenlabs", "local"]).default("edge"),
  voice: z.string().optional(),
  rate: z.number().min(0.5).max(2.0).default(1.0),
});
export type TtsRequest = z.infer<typeof TtsRequest>;

export interface TtsResult {
  audioPath: string;
  duration: number;
  words: WordTiming[];
}

export type CaptionStyle = "classic" | "highlight" | "pop" | "clean";

export const CaptionRequest = z.object({
  style: z.enum(["classic", "highlight", "pop", "clean"]).default("highlight"),
  position: z.enum(["bottom", "center", "top"]).default("bottom"),
  fontSize: z.number().min(24).max(180).default(64),
  // These end up inside generated CSS and JavaScript, so accept only plain values.
  fontFamily: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, "Use a plain font name").default("Inter"),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Use a hex colour like #ffffff").default("#ffffff"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Use a hex colour like #ff9d6b").default("#ff9d6b"),
  wordsPerGroup: z.number().min(1).max(8).default(3),
});
export type CaptionRequest = z.infer<typeof CaptionRequest>;
