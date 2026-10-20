import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCaptionsToProject, generateCaptionHtml, groupWords, mountCaptions } from "../src/audio/caption.js";
import { synthesizeEdge } from "../src/audio/edge.js";
import { CaptionRequest, type WordTiming } from "../src/audio/types.js";
import { checkProject } from "../src/engine/tools.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-audio-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const base = (over: Partial<CaptionRequest> = {}): CaptionRequest => CaptionRequest.parse(over);

const WORDS: WordTiming[] = [
  { text: "Belajar", start: 0.2, end: 0.7 },
  { text: "membuat", start: 0.7, end: 1.1 },
  { text: "video", start: 1.1, end: 1.6 },
  { text: "course", start: 1.6, end: 2.2 },
  { text: "dengan", start: 2.2, end: 2.6 },
  { text: "Memotion.", start: 2.6, end: 3.4 },
];

describe("groupWords", () => {
  it("breaks groups at the word limit, at punctuation and at pauses of 250 ms or more", () => {
    const words: WordTiming[] = [
      { text: "Halo", start: 0, end: 0.3 },
      { text: "semua,", start: 0.3, end: 0.6 },
      { text: "selamat", start: 0.6, end: 0.9 },
      { text: "datang", start: 0.9, end: 1.2 },
      { text: "di", start: 1.2, end: 1.4 },
      { text: "kursus", start: 1.7, end: 2.0 },
      { text: "ini.", start: 2.0, end: 2.3 },
    ];
    expect(groupWords(words, 3).map((g) => g.words.map((w) => w.text))).toEqual([
      ["Halo", "semua,"],
      ["selamat", "datang", "di"],
      ["kursus", "ini."],
    ]);
  });
});

describe("caption styles", () => {
  const groups = groupWords(WORDS, 3);
  const html = (style: CaptionRequest["style"]) => generateCaptionHtml(groups, base({ style }), 1920, 1080);

  it("renders four different results, not two pairs of look-alikes", () => {
    const all = (["highlight", "pop", "classic", "clean"] as const).map(html);
    expect(new Set(all).size).toBe(4);
  });

  it("moves words only in highlight and pop; classic and clean animate the group", () => {
    expect(html("highlight")).toContain("scale: 1.08");
    expect(html("pop")).toContain("back.out(2)");
    for (const s of ["classic", "clean"] as const) {
      expect(html(s)).not.toContain("scale: 1.08");
      expect(html(s)).not.toContain("back.out");
      expect(html(s)).toContain("fromTo(\"#cg-0\"");
    }
  });

  it("hides a pop word until it is spoken (no flash of the full word that then shrinks)", () => {
    expect(html("pop")).toContain('tl.set("#cg-0-w-0", { opacity: 0, scale: 0.7 }, 0.2)');
  });

  it("gives clean a background pill and sentence case, classic uppercase without one", () => {
    expect(html("clean")).toContain("background: rgba(10, 10, 12, 0.62)");
    expect(html("clean")).toContain("text-transform: none");
    expect(html("classic")).toContain("text-transform: uppercase");
    expect(html("classic")).not.toContain("rgba(10, 10, 12, 0.62)");
  });

  it("lifts the portrait caption clear of the app UI at the bottom of a phone screen", () => {
    expect(generateCaptionHtml(groups, base(), 1080, 1920)).toContain("bottom: 420px");
    expect(generateCaptionHtml(groups, base(), 1920, 1080)).toContain("bottom: 100px");
  });

  it("escapes the spoken words", () => {
    const evil = groupWords([{ text: "<img src=x onerror=alert(1)>", start: 0, end: 1 }], 3);
    const out = generateCaptionHtml(evil, base(), 1920, 1080);
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
  });
});

describe("caption request validation (values land in generated CSS and JS)", () => {
  it("rejects colours and font names that could break out of their context", () => {
    expect(() => CaptionRequest.parse({ accentColor: '#fff"; alert(1); //' })).toThrow();
    expect(() => CaptionRequest.parse({ primaryColor: "red" })).toThrow();
    expect(() => CaptionRequest.parse({ fontFamily: "Inter; } body { display:none" })).toThrow();
    expect(CaptionRequest.parse({ fontFamily: "Space Mono", accentColor: "#f90" }).fontFamily).toBe("Space Mono");
  });
});

const INDEX = `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
    <h1 id="title" class="clip" data-start="0" data-duration="5" data-track-index="0">Hi</h1>
  </div>
</body></html>`;

describe("mountCaptions", () => {
  const o = { width: 1920, height: 1080, speechSeconds: 4, audioSrc: "assets/audio/voiceover.mp3", audioSeconds: 3.6 };
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it("adds one audio and one captions host, sized to the speech and stacked above the scene", () => {
    const out = mountCaptions(INDEX, o) ?? "";
    expect(count(out, /id="voiceover"/g)).toBe(1);
    expect(count(out, /data-composition-id="captions"/g)).toBe(1);
    // The audio clip is as long as the audio, not as long as the video.
    expect(out).toContain('src="assets/audio/voiceover.mp3" data-start="0" data-duration="3.6"');
    expect(out).toContain("z-index: 100");
    // Content that was there stays put.
    expect(out).toContain('<h1 id="title"');
  });

  it("is idempotent: mounting again replaces the two elements instead of adding more", () => {
    const once = mountCaptions(INDEX, o) ?? "";
    const twice = mountCaptions(once, { ...o, audioSeconds: 2.2 }) ?? "";
    expect(count(twice, /id="voiceover"/g)).toBe(1);
    expect(count(twice, /data-composition-id="captions"/g)).toBe(1);
    expect(twice).toContain('data-duration="2.2"');
  });

  it("lengthens a short video to cover the speech but never shortens a long one", () => {
    const short = INDEX.replace('data-duration="10"', 'data-duration="3"');
    expect(mountCaptions(short, o)).toContain('id="root" data-composition-id="main" data-start="0" data-duration="5"');
    expect(mountCaptions(INDEX, o)).toContain('data-composition-id="main" data-start="0" data-duration="10"');
  });

  it("refuses a page with no root composition", () => {
    expect(mountCaptions("<html><body><p>x</p></body></html>", o)).toBeNull();
  });
});

describe.skipIf(!process.env.MEMOTION_LIVE_TESTS)("Edge TTS (live network, unofficial service)", () => {
  it("returns audio with word boundaries, and a higher rate makes it shorter", async () => {
    const text = "Halo dunia, ini adalah video edukasi dengan Memotion.";
    const normal = await synthesizeEdge(text, "id-ID-GadisNeural", 1.0);
    expect(normal.audioBytes.length).toBeGreaterThan(1000);
    expect(normal.words.length).toBeGreaterThanOrEqual(6);
    expect(normal.words[0]?.text.toLowerCase()).toContain("halo");
    const fast = await synthesizeEdge(text, "id-ID-GadisNeural", 1.4);
    expect(fast.duration).toBeLessThan(normal.duration * 0.85);
  }, 60_000);
});

describe("applyCaptionsToProject", () => {
  let projectId: string;
  beforeAll(async () => {
    projectId = (await createProject({ name: "Caption Test", orientation: "portrait" })).id;
    const p = projectPath(projectId);
    mkdirSync(join(p, "assets", "audio"), { recursive: true });
    writeFileSync(join(p, "assets", "audio", "voiceover.mp3"), Buffer.alloc(1024));
  }, 60_000);

  it("writes the scene, transcript and mount, passes `check`, and stays one-of-each when run twice", async () => {
    const p = projectPath(projectId);
    for (const style of ["highlight", "clean"] as const) {
      const res = await applyCaptionsToProject(projectId, WORDS, base({ style, fontSize: 56 }), "assets/audio/voiceover.mp3", 3.6);
      expect(res.captionsFile).toBe("compositions/captions.html");
    }
    const scene = readFileSync(join(p, "compositions", "captions.html"), "utf8");
    expect(scene).toContain('window.__timelines["captions"] = tl;');
    expect(scene).toContain("rgba(10, 10, 12, 0.62)"); // the second run (clean) replaced the first
    const index = readFileSync(join(p, "index.html"), "utf8");
    expect((index.match(/id="voiceover"/g) ?? []).length).toBe(1);
    expect((index.match(/data-composition-id="captions"/g) ?? []).length).toBe(1);
    expect(JSON.parse(readFileSync(join(p, "assets", "transcript.json"), "utf8")).words).toHaveLength(6);

    const report = await checkProject(projectId);
    if (!report.ok) console.log("CHECK FINDINGS:", JSON.stringify(report.report, null, 2));
    expect(report.ok).toBe(true);
  }, 120_000);
});
