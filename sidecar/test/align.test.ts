import { describe, expect, it } from "vitest";
import { alignScriptToHeard, estimateByLength, normWord, wordSimilarity } from "../src/audio/align.js";
import type { WordTiming } from "../src/audio/types.js";

const heard = (pairs: [string, number, number][]): WordTiming[] => pairs.map(([text, start, end]) => ({ text, start, end }));
const monotonic = (w: WordTiming[]) => w.every((x, i) => x.end >= x.start && (i === 0 || x.start >= w[i - 1]!.end - 1e-9));

describe("word matching", () => {
  it("ignores case and punctuation, and tolerates a small recognition error but not a different word", () => {
    expect(normWord("Caption,")).toBe("caption");
    expect(wordSimilarity("caption", "caption")).toBe(1);
    expect(wordSimilarity("mengikuti", "menikuti")).toBeGreaterThan(0); // seen in a real whisper run
    expect(wordSimilarity("kursus", "khusus")).toBeGreaterThan(0); // also seen
    expect(wordSimilarity("video", "motion")).toBe(0);
    expect(wordSimilarity("di", "ke")).toBe(0); // short words only match exactly
  });
});

describe("estimateByLength", () => {
  it("covers the audio, orders the words, and leaves a pause after a sentence", () => {
    const w = estimateByLength(["Halo", "dunia.", "Apa", "kabar"], 4);
    expect(monotonic(w)).toBe(true);
    expect(w.at(-1)!.end).toBeCloseTo(4, 2);
    const gapAfterSentence = w[2]!.start - w[1]!.end;
    const gapWithin = w[1]!.start - w[0]!.end;
    expect(gapAfterSentence).toBeGreaterThan(0.2);
    expect(gapWithin).toBeCloseTo(0, 5);
  });

  it("gives a longer word more time", () => {
    const w = estimateByLength(["a", "bukanlah"], 3);
    expect(w[1]!.end - w[1]!.start).toBeGreaterThan((w[0]!.end - w[0]!.start) * 4);
  });

  it("handles nothing to say", () => {
    expect(estimateByLength([], 3)).toEqual([]);
  });
});

describe("alignScriptToHeard", () => {
  it("keeps the script's words and takes the measured times", () => {
    const script = ["Selamat", "datang", "di", "kursus", "membuat", "video."];
    const out = alignScriptToHeard(
      script,
      heard([["Selamat", 0.4, 0.9], ["datang", 0.9, 1.3], ["di", 1.3, 1.4], ["khusus", 1.45, 1.9], ["membuat", 1.9, 2.4], ["video", 2.4, 2.9]]),
      3.2,
    );
    expect(out.map((w) => w.text)).toEqual(script); // "kursus", not whisper's "khusus"
    expect(out[3]).toEqual({ text: "kursus", start: 1.45, end: 1.9 });
    expect(out[5]).toEqual({ text: "video.", start: 2.4, end: 2.9 });
    expect(monotonic(out)).toBe(true);
  });

  it("fills a word whisper missed from the gap between its neighbours, in proportion to its length", () => {
    const out = alignScriptToHeard(
      ["satu", "dua", "tiga", "empat"],
      heard([["satu", 0.5, 1.0], ["empat", 3.0, 3.6]]),
      4,
    );
    expect(out[0]).toEqual({ text: "satu", start: 0.5, end: 1 });
    expect(out[3]).toEqual({ text: "empat", start: 3, end: 3.6 });
    // "dua" (3 letters) and "tiga" (4 letters) share 1.0 -> 3.0 by length.
    expect(out[1]!.start).toBeCloseTo(1.0, 2);
    expect(out[2]!.end).toBeCloseTo(3.0, 2);
    expect(out[2]!.end - out[2]!.start).toBeGreaterThan(out[1]!.end - out[1]!.start);
    expect(monotonic(out)).toBe(true);
  });

  it("ignores words whisper invented that are not in the script", () => {
    const out = alignScriptToHeard(["halo", "dunia"], heard([["uh", 0.1, 0.3], ["halo", 0.4, 0.8], ["eh", 0.8, 0.9], ["dunia", 1.0, 1.5]]), 2);
    expect(out).toEqual([{ text: "halo", start: 0.4, end: 0.8 }, { text: "dunia", start: 1, end: 1.5 }]);
  });

  it("falls back to the length estimate when nothing was heard, and survives a fully wrong transcript", () => {
    expect(alignScriptToHeard(["a", "bb"], [], 2)).toEqual(estimateByLength(["a", "bb"], 2));
    const wrong = alignScriptToHeard(["alpha", "beta"], heard([["zzz", 0.2, 0.5]]), 2);
    expect(wrong.map((w) => w.text)).toEqual(["alpha", "beta"]);
    expect(monotonic(wrong)).toBe(true);
  });

  it("never lets times overlap even when whisper's words do", () => {
    const out = alignScriptToHeard(["a1", "b2"], heard([["a1", 0.5, 1.2], ["b2", 1.0, 1.6]]), 2);
    expect(monotonic(out)).toBe(true);
  });
});
