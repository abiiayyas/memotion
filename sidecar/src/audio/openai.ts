import { z } from "zod";
import type { VoiceOption, WordTiming } from "./types.js";

export const OPENAI_VOICES: VoiceOption[] = [
  { id: "alloy", name: "Alloy", locale: "en-US", provider: "openai" },
  { id: "echo", name: "Echo", locale: "en-US", provider: "openai" },
  { id: "fable", name: "Fable", locale: "en-US", provider: "openai" },
  { id: "onyx", name: "Onyx", locale: "en-US", provider: "openai" },
  { id: "nova", name: "Nova", locale: "en-US", provider: "openai" },
  { id: "shimmer", name: "Shimmer", locale: "en-US", provider: "openai" },
];

const WhisperVerbose = z.object({
  duration: z.number().optional(),
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
});

export interface OpenAiSpeech {
  audioBytes: Buffer;
  duration: number;
  words: WordTiming[];
  /**
   * `measured`: Whisper listened to the generated audio. `estimated`: that step failed, so the times are spread
   * over the script by length and captions will drift. Callers must tell the user.
   */
  timing: "measured" | "estimated";
}

/** Fallback only: spread the script's words over an estimated duration (about 15 characters per second). */
export function estimateWords(text: string, speed: number): { words: WordTiming[]; duration: number } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const duration = Math.max(1, text.length / 15 / speed);
  const step = duration / Math.max(parts.length, 1);
  return {
    duration,
    words: parts.map((w, i) => ({ text: w, start: Math.round(i * step * 1000) / 1000, end: Math.round((i + 1) * step * 1000) / 1000 })),
  };
}

export async function synthesizeOpenAi(
  text: string,
  apiKey: string,
  baseURL: string = "https://api.openai.com/v1",
  voice: string = "alloy",
  speed: number = 1.0,
): Promise<OpenAiSpeech> {
  const ttsRes = await fetch(`${baseURL}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: text, voice, speed, response_format: "mp3" }),
  });
  if (!ttsRes.ok) throw new Error(`OpenAI TTS failed (${ttsRes.status}): ${(await ttsRes.text()).slice(0, 300)}`);
  const audioBytes = Buffer.from(await ttsRes.arrayBuffer());

  // OpenAI's speech endpoint returns no timings, so listen to the result with Whisper to get them.
  try {
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: "audio/mpeg" }), "speech.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const res = await fetch(`${baseURL}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    if (res.ok) {
      const parsed = WhisperVerbose.parse(await res.json());
      const words = (parsed.words ?? []).map((w) => ({ text: w.word.trim(), start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 })).filter((w) => w.text.length > 0);
      if (words.length > 0) {
        return { audioBytes, words, duration: parsed.duration ?? (words.at(-1)?.end ?? 0) + 0.1, timing: "measured" };
      }
    }
  } catch {
    // fall through to the estimate
  }

  return { audioBytes, ...estimateWords(text, speed), timing: "estimated" };
}
