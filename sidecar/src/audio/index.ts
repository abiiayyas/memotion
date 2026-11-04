import { mkdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectPath, safeJoin } from "../projects/store.js";
import { getApiKey } from "../providers/store.js";
import { alignScriptToHeard, estimateByLength } from "./align.js";
import { applyCaptionsToProject } from "./caption.js";
import { listEdgeVoices, POPULAR_EDGE_VOICES, synthesizeEdge } from "./edge.js";
import { DEFAULT_LOCAL_VOICE, LOCAL_VOICES, localVoiceOptions, splitWords, synthesizeLocal, wavToMp3 } from "./localTts.js";
import { findWhisperBinary, whisperModelPath } from "./whisperSetup.js";
import { listElevenLabsVoices, synthesizeElevenLabs } from "./elevenlabs.js";
import { DEFAULT_GEMINI_VOICE, GEMINI_VOICES, isGeminiVoice, synthesizeGemini } from "./gemini.js";
import { OPENAI_VOICES, synthesizeOpenAi } from "./openai.js";
import { getPreferences } from "../preferences.js";
import { preferredModel, transcribeFile, type TranscribeOptions } from "./transcribe.js";
import type { CaptionRequest, TtsRequest, VoiceOption, WordTiming } from "./types.js";

export * from "./types.js";
export * from "./caption.js";
export * from "./edge.js";
export * from "./localTts.js";
export * from "./transcribe.js";

export async function listAllVoices(): Promise<VoiceOption[]> {
  const edge = POPULAR_EDGE_VOICES;
  const openai = OPENAI_VOICES;
  const gemini = GEMINI_VOICES;
  const elevenKey = getApiKey("elevenlabs") ?? process.env.ELEVENLABS_API_KEY;
  let eleven: VoiceOption[] = [];
  if (elevenKey) {
    try {
      eleven = await listElevenLabsVoices(elevenKey);
    } catch {
      // ignore
    }
  }
  return [...localVoiceOptions(), ...edge, ...openai, ...gemini, ...eleven];
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
  } else if (req.provider === "gemini") {
    const key = getApiKey("gemini") ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error("A Google Gemini API key is required for Gemini voices. Add it in the Voice tab.");
    const scratch = join(tmpdir(), `memotion-gemini-tts-${process.pid}-${Date.now()}`);
    await mkdir(scratch, { recursive: true });
    try {
      // The API has no speed setting: speed is applied afterwards, so the voice keeps its pitch.
      const spoken = await synthesizeGemini(req.text, key, isGeminiVoice(req.voice) ? req.voice : DEFAULT_GEMINI_VOICE);
      const wav = join(scratch, "speech.wav");
      const mp3 = join(scratch, "speech.mp3");
      await writeFile(wav, spoken.wav);
      await wavToMp3(wav, mp3, req.rate);
      audioBytes = await readFile(mp3);
      duration = spoken.duration / req.rate;
      // No word timings come back. Spread the words over the span where speech was measured; the caller is told it is an estimate.
      // Inline delivery tags such as <short pause> are not spoken words, so they stay out of the captions.
      words = estimateByLength(splitWords(req.text.replace(/<[^<>\n]{1,40}>/g, " ")), spoken.speechEnd / req.rate, spoken.speechStart / req.rate);
      timingEstimated = true;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } else if (req.provider === "elevenlabs") {
    const key = getApiKey("elevenlabs") ?? process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ElevenLabs API key is required. Add it in the Voice tab.");
    const res = await synthesizeElevenLabs(req.text, key, req.voice);
    audioBytes = res.audioBytes;
    duration = res.duration;
    words = res.words;
  } else if (req.provider === "local") {
    const voiceId = req.voice && LOCAL_VOICES[req.voice] ? req.voice : DEFAULT_LOCAL_VOICE;
    const scratch = join(tmpdir(), `memotion-local-tts-${process.pid}-${Date.now()}`);
    await mkdir(scratch, { recursive: true });
    try {
      const wav = join(scratch, "speech.wav");
      const mp3 = join(scratch, "speech.mp3");
      const res = await synthesizeLocal(req.text, voiceId, req.rate, wav);
      await wavToMp3(wav, mp3);
      audioBytes = await readFile(mp3);
      duration = res.duration;
      words = res.words;
      timingEstimated = true;
      // When whisper is already installed (never installed for this), measure real word times instead of guessing.
      const locale = LOCAL_VOICES[voiceId]?.locale.slice(0, 2);
      if (findWhisperBinary() && existsSync(whisperModelPath("base"))) {
        try {
          const heard = await transcribeFile(mp3, { engine: "local", language: locale, model: "base", allowInstall: false });
          if (heard.words.length > 0) {
            words = alignScriptToHeard(splitWords(req.text), heard.words, duration);
            timingEstimated = false;
          }
        } catch {
          // The estimate stays; the caller is told it is an estimate.
        }
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
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
  const model = transcribeOpts.model ?? preferredModel(getPreferences().whisperModel, transcribeOpts.language);
  const { words } = await transcribeFile(absPath, { ...transcribeOpts, model });
  const capRes = await applyCaptionsToProject(projectId, words, captionOpts);
  return { captionsFile: capRes.captionsFile, duration: capRes.duration, words };
}
