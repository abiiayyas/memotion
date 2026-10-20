import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT, type Voice } from "msedge-tts";
import { z } from "zod";
import type { VoiceOption, WordTiming } from "./types.js";

const MetadataItem = z.object({
  Type: z.string(),
  Data: z.object({
    Offset: z.number(),
    Duration: z.number(),
    text: z.object({
      Text: z.string(),
    }),
  }),
});

const MetadataFile = z.object({
  Metadata: z.array(MetadataItem),
});

export const POPULAR_EDGE_VOICES: VoiceOption[] = [
  { id: "id-ID-GadisNeural", name: "Gadis (Indonesian)", locale: "id-ID", gender: "Female", provider: "edge" },
  { id: "id-ID-ArdiNeural", name: "Ardi (Indonesian)", locale: "id-ID", gender: "Male", provider: "edge" },
  { id: "en-US-JennyNeural", name: "Jenny (US English)", locale: "en-US", gender: "Female", provider: "edge" },
  { id: "en-US-GuyNeural", name: "Guy (US English)", locale: "en-US", gender: "Male", provider: "edge" },
  { id: "en-US-AriaNeural", name: "Aria (US English)", locale: "en-US", gender: "Female", provider: "edge" },
  { id: "en-GB-SoniaNeural", name: "Sonia (British English)", locale: "en-GB", gender: "Female", provider: "edge" },
];

export async function synthesizeEdge(
  text: string,
  voice: string = "id-ID-GadisNeural",
  rate: number = 1.0,
): Promise<{ audioBytes: Buffer; duration: number; words: WordTiming[] }> {
  const tts = new MsEdgeTTS();
  const tempDir = await mkdtemp(join(tmpdir(), "memotion-edge-"));
  try {
    const rateStr = rate === 1.0 ? "+0%" : `${Math.round((rate - 1.0) * 100)}%`;
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: false,
    });
    const res = await tts.toFile(tempDir, text, { rate: rateStr });
    const audioBytes = await readFile(res.audioFilePath);

    let words: WordTiming[] = [];
    if (res.metadataFilePath) {
      try {
        const metaRaw = JSON.parse(await readFile(res.metadataFilePath, "utf8"));
        const parsed = MetadataFile.safeParse(metaRaw);
        if (parsed.success) {
          words = parsed.data.Metadata.filter((m) => m.Type === "WordBoundary").map((m) => ({
            text: m.Data.text.Text,
            start: +(m.Data.Offset / 10_000_000).toFixed(3),
            end: +((m.Data.Offset + m.Data.Duration) / 10_000_000).toFixed(3),
          }));
        }
      } catch {
        // metadata parse failure: fallback to empty words list
      }
    }

    const lastWord = words.at(-1);
    const duration = lastWord ? lastWord.end + 0.1 : 1.0;
    return { audioBytes, duration, words };
  } finally {
    tts.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function listEdgeVoices(): Promise<VoiceOption[]> {
  const tts = new MsEdgeTTS();
  try {
    const raw: Voice[] = await tts.getVoices();
    return raw.map((v) => ({
      id: v.ShortName,
      name: `${v.FriendlyName.replace(/^Microsoft /, "").replace(/ Online \(Natural\)/, "")} (${v.Locale})`,
      locale: v.Locale,
      gender: v.Gender,
      provider: "edge" as const,
    }));
  } finally {
    tts.close();
  }
}
