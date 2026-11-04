import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateSpeechAndCaptions } from "../src/audio/index.js";
import { findFfmpeg } from "../src/audio/localTts.js";
import { GEMINI_VOICES, isGeminiVoice, measureWav, synthesizeGemini } from "../src/audio/gemini.js";
import { createProject } from "../src/projects/store.js";

const SentBody = z.object({ generation_config: z.object({ speech_config: z.array(z.object({ voice: z.string() })) }) });

const dataDir = mkdtempSync(join(tmpdir(), "memotion-gemini-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

/** A 24 kHz mono 16-bit WAV: `lead` s of silence, `tone` s of a loud tone, `tail` s of silence. */
function wav(lead: number, tone: number, tail: number, declaredSize?: number): Buffer {
  const rate = 24000;
  const frames = Math.round((lead + tone + tail) * rate);
  const pcm = Buffer.alloc(frames * 2);
  for (let i = Math.round(lead * rate); i < Math.round((lead + tone) * rate); i++) pcm.writeInt16LE(Math.round(12000 * Math.sin(i / 10)), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(declaredSize ?? pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

describe("reading the WAV Gemini returns", () => {
  it("measures the length and where the speech sits between the silences", () => {
    const m = measureWav(wav(0.5, 1, 0.25));
    expect(m.sampleRate).toBe(24000);
    expect(m.duration).toBeCloseTo(1.75, 3);
    expect(m.speechStart).toBeCloseTo(0.47, 2);
    expect(m.speechEnd).toBeCloseTo(1.53, 2);
  });

  it("reads a WAV whose data size was left at 0 (streamed) to the end of the buffer", () => {
    expect(measureWav(wav(0, 1, 0, 0)).duration).toBeCloseTo(1, 3);
  });

  it("refuses audio that is not a 16-bit WAV instead of guessing", () => {
    expect(() => measureWav(Buffer.from("not audio at all, definitely longer than forty-four bytes!!"))).toThrow(/WAV/);
  });
});

describe("Gemini voices", () => {
  it("offers the 30 prebuilt voices, and lets AI Studio custom voice ids through", () => {
    expect(GEMINI_VOICES).toHaveLength(30);
    expect(new Set(GEMINI_VOICES.map((v) => v.id)).size).toBe(30);
    expect(isGeminiVoice("Kore")).toBe(true);
    expect(isGeminiVoice("voice_abc123")).toBe(true);
    expect(isGeminiVoice("voicekey_abc-123")).toBe(true);
    // A voice of another vendor (what Settings may still hold after a switch) is not one of Gemini's.
    expect(isGeminiVoice("id-ID-GadisNeural")).toBe(false);
    expect(isGeminiVoice(undefined)).toBe(false);
  });
});

describe("Gemini TTS request", () => {
  let server: Server;
  let base = "";
  let mode: "ok" | "denied" | "empty" = "ok";
  const seen: { url?: string; key?: string; body: unknown }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        seen.push({ url: req.url, key: String(req.headers["x-goog-api-key"]), body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        res.writeHead(mode === "denied" ? 403 : 200, { "Content-Type": "application/json" });
        if (mode === "denied") return void res.end('{"error":{"message":"API key not valid"}}');
        const audio = (b: Buffer) => ({ type: "audio", data: b.toString("base64") });
        res.end(JSON.stringify({ steps: mode === "empty" ? [{ type: "model_output", content: [{ type: "text", text: "I cannot" }] }] : [{ type: "user_input" }, { type: "model_output", content: [audio(wav(0, 0.2, 0)), audio(wav(0.1, 1, 0.1))] }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}/v1beta` : "";
  });
  afterAll(() => server.close());

  it("sends the key in a header, the text, the voice and an audio response format, and takes the last audio block", async () => {
    mode = "ok";
    const r = await synthesizeGemini("Halo dunia <short pause> apa kabar", "key-123456", "Puck", base);
    const s = seen.at(-1);
    expect(s?.url).toBe("/v1beta/interactions");
    expect(s?.key).toBe("key-123456");
    expect(s?.body).toMatchObject({
      model: "gemini-3.8-flash-tts",
      input: [{ type: "user_input", content: [{ type: "text", text: "Halo dunia <short pause> apa kabar" }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Puck" }] },
    });
    expect(r.duration).toBeCloseTo(1.2, 3);
  });

  it("surfaces a rejected key with its status, and a reply without audio with a reason", async () => {
    mode = "denied";
    await expect(synthesizeGemini("x", "bad", undefined, base)).rejects.toThrow(/403.*API key not valid/);
    mode = "empty";
    await expect(synthesizeGemini("x", "k", undefined, base)).rejects.toThrow(/no audio/);
  });
});

describe.skipIf(!findFfmpeg())("a Gemini voiceover in a project (real ffmpeg, Gemini answered by a stand-in)", () => {
  it("is saved as the project's mp3 at the chosen speed, with estimated word times inside the speech and no tags in them", async () => {
    const project = await createProject({ name: "Gemini voice", orientation: "landscape" });
    process.env.GEMINI_API_KEY = "env-key-123456";
    const reply = JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: wav(0.5, 2, 0.5).toString("base64") }] }] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(reply, { status: 200 }));
    try {
      const out = await generateSpeechAndCaptions(project.id, { text: "Halo semua <short pause> selamat datang", provider: "gemini", voice: "id-ID-GadisNeural", rate: 2 });
      // 3 s of audio played at double speed.
      expect(out.duration).toBeCloseTo(1.5, 3);
      expect(out.timingEstimated).toBe(true);
      expect(out.words.map((w) => w.text)).toEqual(["Halo", "semua", "selamat", "datang"]);
      expect(out.words[0]?.start).toBeGreaterThanOrEqual(0.23);
      expect(out.words.at(-1)?.end).toBeLessThanOrEqual(1.27);
      // A voice of another vendor falls back to Gemini's default rather than being sent to it.
      expect(SentBody.parse(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).generation_config.speech_config).toEqual([{ voice: "Kore" }]);
      const file = join(dataDir, "projects", project.id, out.audioPath);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(0, 3).toString("latin1")).toMatch(/^(ID3|\xff[\xe0-\xff])/);
    } finally {
      fetchSpy.mockRestore();
      delete process.env.GEMINI_API_KEY;
    }
  }, 60_000);
});
