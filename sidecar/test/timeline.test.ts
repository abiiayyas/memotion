import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editTimeline, readTimeline, setRootDuration, undoTimeline, type TimelineClip } from "../src/engine/timeline.js";
import { createProject, projectPath } from "../src/projects/store.js";
import { parseVariables, withVariableDefault } from "../src/projects/variables.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-tl-"));
process.env.MEMOTION_DATA_DIR = dataDir;

const INDEX = `<!doctype html>
<html lang="en" data-composition-variables='[{"id":"headline","type":"string","label":"Headline","default":"Halo"},{"id":"accent","type":"color","label":"Accent","default":"#ff7a3d"},{"id":"size","type":"number","label":"Size","default":40,"min":10,"max":100},{"id":"tone","type":"enum","label":"Tone","default":"warm","options":[{"value":"warm"},{"value":"cool"}]}]'>
  <head><meta charset="UTF-8" /><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>html,body{margin:0;width:1920px;height:1080px;background:#111}</style></head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
      <h1 id="a" class="clip" data-start="0" data-duration="3" data-track-index="0">A</h1>
      <h2 id="b" class="clip" data-start="3" data-duration="3" data-track-index="0">B</h2>
      <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="6" data-duration="4" data-track-index="1" data-width="1920" data-height="1080"></div>
    </div>
    <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
  </body>
</html>
`;

const INTRO = `<template>
  <style>#root { position: absolute; inset: 0; }</style>
  <div id="root" data-composition-id="intro" data-width="1920" data-height="1080">
    <h1 id="intro-title" class="clip" data-start="0.5" data-duration="3" data-track-index="0" data-var-text="headline">Halo</h1>
  </div>
  <script>const tl = gsap.timeline({ paused: true }); window.__timelines["intro"] = tl;</script>
</template>
`;

describe("setRootDuration", () => {
  it("changes only the root composition's data-duration and reports the old value", () => {
    const out = setRootDuration(INDEX, 12.5);
    expect(out?.before).toBe(10);
    expect(out?.html).toContain('id="root" data-composition-id="main" data-start="0" data-duration="12.5"');
    // The scene host (has data-composition-src) and the clips keep their own durations.
    expect(out?.html).toContain('data-composition-src="compositions/intro.html" data-start="6" data-duration="4"');
    expect(out?.html.replace('data-duration="12.5"', 'data-duration="10"')).toBe(INDEX);
  });
  it("returns null when no root composition declares a duration", () => {
    expect(setRootDuration("<html><body><p>hi</p></body></html>", 5)).toBeNull();
  });
});

describe("variables", () => {
  it("parses the attribute and rewrites one default, leaving the rest of the file byte-identical", () => {
    expect(parseVariables(INDEX)?.map((v) => v.id)).toEqual(["headline", "accent", "size", "tone"]);
    const next = withVariableDefault(INDEX, "headline", "Kopi 'Senja' & Teh");
    expect(parseVariables(next)?.find((v) => v.id === "headline")?.default).toBe("Kopi 'Senja' & Teh");
    // Only the attribute changed.
    expect(next.replace(/data-composition-variables='[^']*'/, "")).toBe(INDEX.replace(/data-composition-variables='[^']*'/, ""));
    // Other variables and the extra keys the runtime reads (min/max/options) survive.
    const size = parseVariables(next)?.find((v) => v.id === "size");
    expect(size).toMatchObject({ default: 40, min: 10, max: 100 });
  });
  it("rejects values that break the declared type or bounds", () => {
    expect(() => withVariableDefault(INDEX, "size", 500)).toThrow();
    expect(() => withVariableDefault(INDEX, "accent", "orange")).toThrow();
    expect(() => withVariableDefault(INDEX, "tone", "hot")).toThrow();
    expect(() => withVariableDefault(INDEX, "nope", "x")).toThrow(/Unknown variable/);
  });
});

describe("timeline editing through the HyperFrames CLI", () => {
  let id: string;
  const byId = (clips: TimelineClip[], clipId: string): TimelineClip => {
    const c = clips.find((x) => x.id === clipId);
    if (!c) throw new Error(`no clip ${clipId}`);
    return c;
  };

  beforeAll(async () => {
    id = (await createProject({ name: "Timeline test", orientation: "landscape" })).id;
    writeFileSync(join(projectPath(id), "index.html"), INDEX);
    mkdirSync(join(projectPath(id), "compositions"), { recursive: true });
    writeFileSync(join(projectPath(id), "compositions", "intro.html"), INTRO);
  }, 120_000);

  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it("reads clips with project length, and gives scene clips an offset to project time", async () => {
    const t = await readTimeline(id);
    expect(t.duration).toBe(10);
    expect(byId(t.clips, "a")).toMatchObject({ start: 0, duration: 3, nested: false, offset: 0 });
    const nested = byId(t.clips, "intro-title");
    expect(nested).toMatchObject({ nested: true, host: "intro", start: 0.5, absStart: 6.5, offset: 6, file: "compositions/intro.html" });
  }, 60_000);

  it("moves a scene clip using scene-local time and refuses an overlap with the reason", async () => {
    // Local 1.0 = project 7.0.
    expect(await editTimeline(id, { op: "move", ref: "#intro-title", start: 1 })).toEqual({ ok: true });
    expect(byId((await readTimeline(id)).clips, "intro-title")).toMatchObject({ start: 1, absStart: 7 });

    const refused = await editTimeline(id, { op: "move", ref: "#b", start: 2 });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toMatch(/overlap/i);
    expect(byId((await readTimeline(id)).clips, "b").start).toBe(3);
  }, 90_000);

  it("returns a plain-language reason (not raw CLI JSON) when a move runs past the end of the video", async () => {
    const res = await editTimeline(id, { op: "move", ref: "#b", start: 9 });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/^move would end at \d+(\.\d+)?, beyond composition duration 10/);
    expect(res.ok === false && res.fix).toMatch(/latest valid start/);
  }, 60_000);

  it("trims either edge, splits, and undo/redo walk the history in order", async () => {
    expect(await editTimeline(id, { op: "trim", ref: "#b", end: 5 })).toEqual({ ok: true });
    expect(byId((await readTimeline(id)).clips, "b")).toMatchObject({ start: 3, duration: 2, end: 5 });

    expect(await editTimeline(id, { op: "trim", ref: "#b", start: 4, end: 5 })).toEqual({ ok: true });
    expect(byId((await readTimeline(id)).clips, "b")).toMatchObject({ start: 4, duration: 1, end: 5 });

    expect(await editTimeline(id, { op: "split", ref: "#a", at: 1.5 })).toEqual({ ok: true });
    const split = (await readTimeline(id)).clips.filter((c) => c.tag === "h1" && !c.nested).map((c) => [c.start, c.duration]);
    expect(split).toEqual([[0, 1.5], [1.5, 1.5]]);

    // Undo the split, then the left trim; redo the left trim.
    const t0 = await readTimeline(id);
    expect(t0.canUndo).toBe(true);
    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect((await readTimeline(id)).clips.filter((c) => c.tag === "h1" && !c.nested)).toHaveLength(1);
    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect(byId((await readTimeline(id)).clips, "b")).toMatchObject({ start: 3, duration: 2 });
    expect(await undoTimeline(id, "redo")).toEqual({ ok: true });
    expect(byId((await readTimeline(id)).clips, "b")).toMatchObject({ start: 4, duration: 1 });
  }, 120_000);

  it("changes project length with undo, and a new edit clears redo", async () => {
    expect(await editTimeline(id, { op: "length", seconds: 14 })).toEqual({ ok: true });
    expect((await readTimeline(id)).duration).toBe(14);
    expect(readFileSync(join(projectPath(id), "index.html"), "utf8")).toContain('data-composition-id="main" data-start="0" data-duration="14"');

    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect((await readTimeline(id)).duration).toBe(10);
    expect((await readTimeline(id)).canRedo).toBe(true);

    expect(await editTimeline(id, { op: "length", seconds: 11 })).toEqual({ ok: true });
    expect((await readTimeline(id)).canRedo).toBe(false);
  }, 120_000);

  it("refuses an undo whose file was edited since, and keeps the entry for later", async () => {
    expect(await editTimeline(id, { op: "move", ref: "#intro-title", start: 0.5 })).toEqual({ ok: true });
    const file = join(projectPath(id), "compositions", "intro.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(">Halo<", ">Halo!<"));
    const res = await undoTimeline(id, "undo");
    expect(res.ok).toBe(false);
    expect((await readTimeline(id)).canUndo).toBe(true);
  }, 90_000);
});
