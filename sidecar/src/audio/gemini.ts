import { z } from "zod";
import type { VoiceOption } from "./types.js";

/**
 * Google Gemini text-to-speech through the Interactions API (`POST /v1beta/interactions`), as documented for the
 * Gemini 3.8 TTS models. A request returns one complete WAV (24 kHz, mono, 16-bit) and no word timings, so captions
 * get estimated or Whisper-measured times, like the offline voice.
 */
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
export const DEFAULT_GEMINI_VOICE = "Kore";

/** The 30 prebuilt studio voices. The model detects the language of the text itself. */
const PREBUILT: [string, string][] = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"], ["Kore", "Firm"], ["Fenrir", "Excitable"],
  ["Leda", "Youthful"], ["Orus", "Firm"], ["Aoede", "Breezy"], ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"], ["Iapetus", "Clear"], ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"],
  ["Erinome", "Clear"], ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"], ["Laomedeia", "Upbeat"], ["Achernar", "Soft"],
  ["Alnilam", "Firm"], ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"], ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"], ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
];

export const GEMINI_VOICES: VoiceOption[] = PREBUILT.map(([id, tone]) => ({ id, name: `${id} (${tone})`, locale: "multilingual", provider: "gemini" as const }));

/** A voice the user made in Google AI Studio (Voice design / replication) is named `voice_…`; `voicekey_…` is a stateless replica. */
export function isGeminiVoice(id: string | undefined): id is string {
  return id !== undefined && (GEMINI_VOICES.some((v) => v.id === id) || /^voice(key)?_[A-Za-z0-9_-]+$/.test(id));
}

const Interaction = z.object({
  steps: z
    .array(
      z.looseObject({
        type: z.string(),
        content: z.array(z.looseObject({ type: z.string(), data: z.string().optional() })).optional(),
      }),
    )
    .default([]),
});

export interface WavAudio {
  sampleRate: number;
  /** Seconds of audio. */
  duration: number;
  /** Where the speech starts and ends: leading and trailing silence trimmed (with a small margin), for word timing. */
  speechStart: number;
  speechEnd: number;
}

/** Read a PCM WAV (16-bit, mono or more channels) and measure it. Throws on anything else. */
export function measureWav(wav: Buffer): WavAudio {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Gemini did not return a WAV file.");
  let rate = 0;
  let channels = 1;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      if (wav.readUInt16LE(body + 14) !== 16) throw new Error("Gemini returned audio that is not 16-bit.");
      channels = Math.max(1, wav.readUInt16LE(body + 2));
      rate = wav.readUInt32LE(body + 4);
    } else if (id === "data") {
      if (rate === 0) throw new Error("The WAV from Gemini has no format block.");
      // A streamed WAV can declare a size of 0 or 0xFFFFFFFF; the data then runs to the end of the buffer.
      const end = size === 0 || body + size > wav.length ? wav.length : body + size;
      const frames = Math.floor((end - body) / (2 * channels));
      let first = -1;
      let last = -1;
      for (let i = 0; i < frames; i++) {
        const sample = Math.abs(wav.readInt16LE(body + i * 2 * channels));
        if (sample >= 328) {
          if (first < 0) first = i;
          last = i;
        }
      }
      const duration = frames / rate;
      if (first < 0) return { sampleRate: rate, duration, speechStart: 0, speechEnd: duration };
      return { sampleRate: rate, duration, speechStart: Math.max(0, first / rate - 0.03), speechEnd: Math.min(duration, (last + 1) / rate + 0.03) };
    }
    at = body + size + (size % 2);
  }
  throw new Error("The WAV from Gemini has no audio data.");
}

export async function synthesizeGemini(
  text: string,
  apiKey: string,
  voice: string = DEFAULT_GEMINI_VOICE,
  baseURL: string = DEFAULT_BASE,
  model: string = GEMINI_TTS_MODEL,
): Promise<{ wav: Buffer } & WavAudio> {
  const res = await fetch(`${baseURL}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Gemini TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  const audio = Interaction.parse(await res.json())
    .steps.filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "audio" && c.data)
    .at(-1);
  if (!audio?.data) throw new Error("Gemini returned no audio. The text may have been refused; try rewording it.");
  const wav = Buffer.from(audio.data, "base64");
  return { wav, ...measureWav(wav) };
}
