import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalTranscriptionUnavailable, normalizeTranscript, transcribeFile } from "../src/audio/transcribe.js";

const dir = mkdtempSync(join(tmpdir(), "memotion-stt-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("normalizeTranscript", () => {
  it("keeps word-level entries and drops music notes, replacement characters and sound tags", () => {
    const out = normalizeTranscript([
      { text: " Halo ", start: 0, end: 0.4 },
      { text: "♪", start: 0.4, end: 0.8 },
      { text: "[MUSIC]", start: 0.8, end: 1 },
      { text: "\uFFFD\uFFFD", start: 1, end: 1.2 },
      { text: "dunia", start: 1.2, end: 1.6 },
    ]);
    expect(out).toEqual([
      { text: "Halo", start: 0, end: 0.4 },
      { text: "dunia", start: 1.2, end: 1.6 },
    ]);
  });

  it("splits a whole cue into words, spreading its time by character count without gaps or overlap", () => {
    // "ab cdef" = 2 + 4 characters over 3 seconds -> 1 s and 2 s.
    const out = normalizeTranscript([{ text: "ab cdef", start: 1, end: 4 }]);
    expect(out).toEqual([
      { text: "ab", start: 1, end: 2 },
      { text: "cdef", start: 2, end: 4 },
    ]);
  });
});

describe("local transcription through the real HyperFrames CLI", () => {
  const srt = join(dir, "talk.srt");
  beforeAll(() => {
    writeFileSync(
      srt,
      "1\n00:00:00,200 --> 00:00:01,400\nWelcome to the course.\n\n2\n00:00:01,600 --> 00:00:04,000\nToday we build captions.\n",
    );
  });

  // An SRT goes through the CLI's import path: no whisper needed, and it exercises the real `--json` output shape
  // (`{ok, transcriptPath}`) and the transcript file format that the parser depends on.
  it("imports a transcript file and returns timed words", async () => {
    const t = await transcribeFile(srt, { engine: "local" });
    expect(t.words.map((w) => w.text)).toEqual(["Welcome", "to", "the", "course.", "Today", "we", "build", "captions."]);
    expect(t.words[0]?.start).toBeCloseTo(0.2, 2);
    expect(t.words[3]?.end).toBeCloseTo(1.4, 2);
    expect(t.words[4]?.start).toBeCloseTo(1.6, 2);
    expect(t.duration).toBeGreaterThan(4);
    for (let i = 1; i < t.words.length; i++) expect(t.words[i]!.start).toBeGreaterThanOrEqual(t.words[i - 1]!.start);
  }, 60_000);

  const whisperInstalled = (() => {
    try {
      execFileSync("sh", ["-c", "command -v whisper-cli || command -v whisper-cpp"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  // The default must never install software on the user's machine.
  it.skipIf(whisperInstalled)("reports local transcription as unavailable instead of installing whisper-cpp", async () => {
    const wav = join(dir, "tone.wav");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav]);
    await expect(transcribeFile(wav, { engine: "local" })).rejects.toBeInstanceOf(LocalTranscriptionUnavailable);
  }, 60_000);
});

describe("OpenAI Whisper engine", () => {
  let server: Server;
  let baseURL: string;
  const seen: { auth?: string; body: string }[] = [];
  let respond: { status: number; json: unknown } = { status: 200, json: {} };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        seen.push({ auth: req.headers.authorization, body: Buffer.concat(chunks).toString("latin1") });
        res.writeHead(respond.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(respond.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no port");
    baseURL = `http://127.0.0.1:${addr.port}/v1`;
    writeFileSync(join(dir, "speech.mp3"), Buffer.alloc(256));
  });
  afterAll(() => server.close());

  it("asks for word timestamps with the key, and maps the reply", async () => {
    respond = { status: 200, json: { duration: 2.5, text: "Halo dunia", words: [{ word: "Halo", start: 0.1, end: 0.6 }, { word: "dunia", start: 0.7, end: 1.4 }] } };
    const t = await transcribeFile(join(dir, "speech.mp3"), { openAi: { apiKey: "sk-test", baseURL }, language: "id" });
    expect(t.words).toEqual([{ text: "Halo", start: 0.1, end: 0.6 }, { text: "dunia", start: 0.7, end: 1.4 }]);
    expect(t.duration).toBe(2.5);
    const req = seen.at(-1)!;
    expect(req.auth).toBe("Bearer sk-test");
    expect(req.body).toContain('name="model"');
    expect(req.body).toContain("whisper-1");
    expect(req.body).toContain("verbose_json");
    expect(req.body).toContain("word");
    expect(req.body).toContain('name="language"');
  });

  it("surfaces an API error instead of returning an empty transcript", async () => {
    respond = { status: 401, json: { error: { message: "bad key" } } };
    await expect(transcribeFile(join(dir, "speech.mp3"), { openAi: { apiKey: "nope", baseURL } })).rejects.toThrow(/401/);
  });
});
