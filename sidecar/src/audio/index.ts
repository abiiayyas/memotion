import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectPath, safeJoin } from "../projects/store.js";
import { getApiKey } from "../providers/store.js";
import { applyCaptionsToProject } from "./caption.js";
import { listEdgeVoices, POPULAR_EDGE_VOICES, synthesizeEdge } from "./edge.js";
import { listElevenLabsVoices, synthesizeElevenLabs } from "./elevenlabs.js";
import { OPENAI_VOICES, synthesizeOpenAi } from "./openai.js";
import { transcribeFile, type TranscribeOptions } from "./transcribe.js";
import type { CaptionRequest, TtsRequest, VoiceOption, WordTiming } from "./types.js";

export * from "./types.js";
export * from "./caption.js";
export * from "./edge.js";
export * from "./transcribe.js";

export async function listAllVoices(): Promise<VoiceOption[]> {
  const edge = POPULAR_EDGE_VOICES;
  const openai = OPENAI_VOICES;
  const elevenKey = getApiKey("elevenlabs") ?? process.env.ELEVENLABS_API_KEY;
  let eleven: VoiceOption[] = [];
  if (elevenKey) {
    try {
      eleven = await listElevenLabsVoices(elevenKey);
    } catch {
      // ignore
    }
  }
  return [...edge, ...openai, ...eleven];
}

export async function generateSpeechAndCaptions(
  projectId: string,
  req: TtsRequest,
  captionOpts?: CaptionRequest,
): Promise<{ audioPath: string; duration: number; words: WordTiming[]; captionsFile?: string; timingEstimated: boolean }> {
  let audioBytes: Buffer;
  let duration: number;
  let words: WordTiming[];
  let timingEstimated = false;

  if (req.provider === "openai") {
    const key = getApiKey("openai") ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI API key is required for OpenAI TTS. Add it in the Voice tab.");
    const res = await synthesizeOpenAi(req.text, key, undefined, req.voice, req.rate);
    audioBytes = res.audioBytes;
    duration = res.duration;
    words = res.words;
    timingEstimated = res.timing === "estimated";
  } else if (req.provider === "elevenlabs") {
    const key = getApiKey("elevenlabs") ?? process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ElevenLabs API key is required. Add it in the Voice tab.");
    const res = await synthesizeElevenLabs(req.text, key, req.voice);
    audioBytes = res.audioBytes;
    duration = res.duration;
    words = res.words;
  } else {
    // Default: Edge TTS (free, no API key required)
    const res = await synthesizeEdge(req.text, req.voice, req.rate);
    audioBytes = res.audioBytes;
    duration = res.duration;
    words = res.words;
  }

  // A preview or render may read the file while we write it: publish it whole, by rename.
  const root = projectPath(projectId);
  const audioDir = join(root, "assets", "audio");
  await mkdir(audioDir, { recursive: true });
  const audioPath = "assets/audio/voiceover.mp3";
  const tmp = join(audioDir, ".voiceover.mp3.part");
  await writeFile(tmp, audioBytes);
  await rename(tmp, join(root, audioPath));

  let captionsFile: string | undefined;
  if (captionOpts && words.length > 0) {
    const capRes = await applyCaptionsToProject(projectId, words, captionOpts, audioPath, duration);
    captionsFile = capRes.captionsFile;
  }

  return { audioPath, duration, words, captionsFile, timingEstimated };
}

export async function transcribeAndCaption(
  projectId: string,
  mediaRelPath: string,
  captionOpts: CaptionRequest = {
    style: "highlight",
    position: "bottom",
    fontSize: 64,
    fontFamily: "Inter",
    primaryColor: "#ffffff",
    accentColor: "#ff9d6b",
    wordsPerGroup: 3,
  },
  transcribeOpts: TranscribeOptions = {},
): Promise<{ captionsFile: string; duration: number; words: WordTiming[] }> {
  // The path comes from the UI or the model: it must stay inside the project.
  const absPath = safeJoin(projectPath(projectId), mediaRelPath);
  const { words } = await transcribeFile(absPath, transcribeOpts);
  const capRes = await applyCaptionsToProject(projectId, words, captionOpts);
  return { captionsFile: capRes.captionsFile, duration: capRes.duration, words };
}
