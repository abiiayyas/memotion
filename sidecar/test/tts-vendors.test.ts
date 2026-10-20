import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listElevenLabsVoices, synthesizeElevenLabs, wordsFromAlignment } from "../src/audio/elevenlabs.js";
import { estimateWords, synthesizeOpenAi } from "../src/audio/openai.js";

interface Seen {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A local stand-in for a vendor API. These tests check our request shape and response mapping, not the vendor. */
function mockVendor(handler: (seen: Seen) => { status: number; type: string; body: string | Buffer }): { server: Server; seen: Seen[] } {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      const s: Seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("latin1") };
      seen.push(s);
      const out = handler(s);
      res.writeHead(out.status, { "Content-Type": out.type });
      res.end(out.body);
    });
  });
  return { server, seen };
}

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    resolve(typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "");
  }));

describe("ElevenLabs", () => {
  it("turns per-character timing into words, across spaces, punctuation and multi-byte text", () => {
    const chars = [..."Hi, kamu ✓"];
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.08);
    const words = wordsFromAlignment({ characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends });
    expect(words.map((w) => w.text)).toEqual(["Hi,", "kamu", "✓"]);
    // Characters: H0 i1 ,2 ␠3 k4 a5 m6 u7 ␠8 ✓9. A word runs from its first character's start to its last one's end.
    expect(words).toEqual([
      { text: "Hi,", start: 0, end: 0.28 },
      { text: "kamu", start: 0.4, end: 0.78 },
      { text: "✓", start: 0.9, end: 0.98 },
    ]);
  });

  describe("against a local mock", () => {
    let server: Server;
    let base: string;
    let seen: Seen[];
    let mode: "ok" | "denied" = "ok";

    beforeAll(async () => {
      const m = mockVendor((s) => {
        if (mode === "denied") return { status: 401, type: "application/json", body: '{"detail":{"status":"invalid_api_key"}}' };
        if (s.url?.endsWith("/with-timestamps")) {
          const chars = [..."Halo dunia"];
          return {
            status: 200,
            type: "application/json",
            body: JSON.stringify({
              audio_base64: Buffer.from("FAKEMP3").toString("base64"),
              alignment: {
                characters: chars,
                character_start_times_seconds: chars.map((_, i) => i * 0.1),
                character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
              },
            }),
          };
        }
        return { status: 200, type: "application/json", body: JSON.stringify({ voices: [{ voice_id: "v1", name: "Rachel", labels: { accent: "american", gender: "female" } }, { voice_id: "v2", name: "Budi" }] }) };
      });
      server = m.server;
      seen = m.seen;
      base = await listen(server);
    });
    afterAll(() => server.close());

    it("sends the key and model, decodes the audio and maps the words", async () => {
      mode = "ok";
      const r = await synthesizeElevenLabs("Halo dunia", "xi-key-123", "voice/with slash", base);
      expect(r.audioBytes.toString()).toBe("FAKEMP3");
      expect(r.words.map((w) => w.text)).toEqual(["Halo", "dunia"]);
      expect(r.duration).toBeCloseTo(1.0 + 0.1, 5);
      const req = seen.at(-1)!;
      expect(req.headers["xi-api-key"]).toBe("xi-key-123");
      expect(req.url).toBe("/text-to-speech/voice%2Fwith%20slash/with-timestamps");
      expect(JSON.parse(req.body)).toMatchObject({ text: "Halo dunia", model_id: "eleven_multilingual_v2" });
    });

    it("lists voices with a readable label", async () => {
      const v = await listElevenLabsVoices("xi-key-123", base);
      expect(v.map((x) => x.name)).toEqual(["Rachel (american)", "Budi (ElevenLabs)"]);
      expect(v.every((x) => x.provider === "elevenlabs")).toBe(true);
    });

    it("surfaces a rejected key instead of returning silent audio", async () => {
      mode = "denied";
      await expect(synthesizeElevenLabs("x", "bad", undefined, base)).rejects.toThrow(/401/);
      await expect(listElevenLabsVoices("bad", base)).rejects.toThrow(/401/);
    });
  });
});

describe("OpenAI TTS", () => {
  let server: Server;
  let base: string;
  let seen: Seen[];
  let whisper: "ok" | "fail" = "ok";

  beforeAll(async () => {
    const m = mockVendor((s) => {
      if (s.url?.endsWith("/audio/speech")) return { status: 200, type: "audio/mpeg", body: Buffer.from("MP3BYTES") };
      if (whisper === "fail") return { status: 500, type: "application/json", body: "{}" };
      return { status: 200, type: "application/json", body: JSON.stringify({ duration: 2.0, words: [{ word: " Halo", start: 0.1, end: 0.5 }, { word: "dunia", start: 0.6, end: 1.2 }] }) };
    });
    server = m.server;
    seen = m.seen;
    base = await listen(server);
  });
  afterAll(() => server.close());

  it("requests speech with voice and speed, then takes word times from Whisper (measured)", async () => {
    whisper = "ok";
    const r = await synthesizeOpenAi("Halo dunia", "sk-test", base, "nova", 1.2);
    expect(r.timing).toBe("measured");
    expect(r.words).toEqual([{ text: "Halo", start: 0.1, end: 0.5 }, { text: "dunia", start: 0.6, end: 1.2 }]);
    expect(r.duration).toBe(2);
    const speech = seen.find((s) => s.url?.endsWith("/audio/speech"))!;
    expect(speech.headers.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(speech.body)).toMatchObject({ model: "tts-1", input: "Halo dunia", voice: "nova", speed: 1.2 });
  });

  it("says so when it had to estimate the timing, rather than passing guesses off as measurements", async () => {
    whisper = "fail";
    const r = await synthesizeOpenAi("satu dua tiga empat", "sk-test", base);
    expect(r.timing).toBe("estimated");
    expect(r.words.map((w) => w.text)).toEqual(["satu", "dua", "tiga", "empat"]);
  });

  it("spreads estimated words evenly with no gaps", () => {
    const { words, duration } = estimateWords("a b c d", 1);
    expect(words[0]?.start).toBe(0);
    for (let i = 1; i < words.length; i++) expect(words[i]?.start).toBe(words[i - 1]?.end);
    expect(words.at(-1)?.end).toBeCloseTo(duration, 2);
  });
});
