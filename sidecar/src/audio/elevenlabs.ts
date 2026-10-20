import { z } from "zod";
import type { VoiceOption, WordTiming } from "./types.js";

const DEFAULT_BASE = "https://api.elevenlabs.io/v1";

const Alignment = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});
export type Alignment = z.infer<typeof Alignment>;

const TimestampsResponse = z.object({ audio_base64: z.string(), alignment: Alignment });

const VoicesResponse = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string(),
      name: z.string(),
      labels: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

/** ElevenLabs times every character; captions need words. A word is a run of non-space characters. */
export function wordsFromAlignment(a: Alignment): WordTiming[] {
  const words: WordTiming[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text.length === 0) return;
    words.push({ text, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
    text = "";
  };
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i] ?? "";
    const s = a.character_start_times_seconds[i] ?? end;
    const e = a.character_end_times_seconds[i] ?? s;
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (text.length === 0) start = s;
    text += ch;
    end = e;
  }
  flush();
  return words;
}

export async function synthesizeElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string = "21m00Tcm4TlvDq8ikWAM", // Rachel
  baseURL: string = DEFAULT_BASE,
): Promise<{ audioBytes: Buffer; duration: number; words: WordTiming[] }> {
  const res = await fetch(`${baseURL}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  const data = TimestampsResponse.parse(await res.json());
  const words = wordsFromAlignment(data.alignment);
  const last = words.at(-1);
  return { audioBytes: Buffer.from(data.audio_base64, "base64"), duration: last ? last.end + 0.1 : 1, words };
}

export async function listElevenLabsVoices(apiKey: string, baseURL: string = DEFAULT_BASE): Promise<VoiceOption[]> {
  const res = await fetch(`${baseURL}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs voices failed (${res.status})`);
  return VoicesResponse.parse(await res.json()).voices.map((v) => ({
    id: v.voice_id,
    name: `${v.name} (${v.labels?.accent ?? v.labels?.gender ?? "ElevenLabs"})`,
    locale: v.labels?.language ?? "multilingual",
    gender: v.labels?.gender,
    provider: "elevenlabs" as const,
  }));
}
