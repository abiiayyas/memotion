import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { synthesizeEdge } from "../src/audio/edge.js";
import { transcribeFile } from "../src/audio/transcribe.js";
import { findWhisperBinary } from "../src/audio/whisperSetup.js";

const dir = mkdtempSync(join(tmpdir(), "memotion-stt-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Needs the network (Edge TTS makes the speech), whisper.cpp built, and the `base` model downloaded once.
// Opt in with MEMOTION_LIVE_TESTS=1. The speech is generated, so the correct answer is known.
describe.skipIf(!process.env.MEMOTION_LIVE_TESTS || !findWhisperBinary())("real local transcription", () => {
  it("transcribes Indonesian speech into the words that were spoken, in order, with plausible times", async () => {
    const spoken = "Selamat datang di kursus membuat video motion. Hari ini kita belajar membuat caption.";
    const speech = await synthesizeEdge(spoken, "id-ID-ArdiNeural");
    const file = join(dir, "speech.mp3");
    writeFileSync(file, speech.audioBytes);

    const t = await transcribeFile(file, { engine: "local", language: "id", model: "base" });

    const heard = t.words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
    // The small model may get a word wrong; the content words must be there, in the order they were spoken.
    const order = ["selamat", "datang", "kursus", "video", "motion", "belajar", "caption"].map((w) => heard.indexOf(w));
    expect(order.every((i) => i >= 0), `heard: ${heard.join(" ")}`).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(heard.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < t.words.length; i++) expect(t.words[i]!.start).toBeGreaterThanOrEqual(t.words[i - 1]!.start);
    // The speech runs about 6-7 s: every word must fall inside it, not across a padded 30 s window.
    expect(t.words.at(-1)!.end).toBeLessThan(speech.duration + 2);
  }, 300_000);
});
