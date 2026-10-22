import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editTimeline, planFor, planLaneMoves, readTimeline, setTrackIndex, undoTimeline, type TimelineClip } from "../src/engine/timeline.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-tlg-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const INDEX = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><script src="assets/vendor/gsap.min.js"></script></head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="10" data-width="1920" data-height="1080">
      <h1 id="a" class="clip" data-start="0" data-duration="2" data-track-index="0">A</h1>
      <h1 id="b" class="clip" data-start="2" data-duration="2" data-track-index="0">B</h1>
      <h1 id="c" class="clip" data-start="4" data-duration="2" data-track-index="0">C</h1>
      <h2 id="d" class="clip" data-start="1" data-duration="3" data-track-index="1">D</h2>
    </div>
    <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
  </body>
</html>
`;

const clip = (partial: Partial<TimelineClip> & Pick<TimelineClip, "ref" | "id" | "absStart" | "absEnd">): TimelineClip => ({
  tag: "h1", trackKind: "graphics", trackIndex: 0, start: partial.absStart, duration: partial.absEnd - partial.absStart, end: partial.absEnd,
  file: "index.html", src: null, nested: false, host: null, offset: 0, mediaStart: null, warnings: [], ...partial,
});

describe("setTrackIndex (which lane a clip is drawn in)", () => {
  const html = '<div id="a" class="clip" data-start="0" data-track-index="2">x</div><p data-hf-id=\'hf1\' data-start="1">y</p><img id="pic" src="p.png" />';

  it("changes the value, and touches nothing else in the file", () => {
    const out = setTrackIndex(html, "#a", 5);
    expect(out?.before).toBe(2);
    expect(out?.html).toBe(html.replace('data-track-index="2"', 'data-track-index="5"'));
  });

  it("adds the attribute where it was missing (also on a self-closing tag), and finds an element by data-hf-id", () => {
    expect(setTrackIndex(html, "hf:hf1", 3)?.html).toContain("<p data-hf-id='hf1' data-start=\"1\" data-track-index=\"3\">y</p>");
    expect(setTrackIndex(html, "#pic", 1)?.html).toContain('<img id="pic" src="p.png" data-track-index="1"/>');
    expect(setTrackIndex(html, "#pic", 1)?.before).toBeNull();
  });

  it("puts the file back exactly with null (the undo of an add) and says so for an element that is not there", () => {
    const added = setTrackIndex(html, "#pic", 1)!.html;
    expect(setTrackIndex(added, "#pic", null)?.html).toBe(html.replace('<img id="pic" src="p.png" />', '<img id="pic" src="p.png"/>'));
    expect(setTrackIndex(html, "#nope", 1)).toBeNull();
    // "#hf1" is not the element whose data-hf-id is hf1.
    expect(setTrackIndex(html, "#hf1", 1)).toBeNull();
  });
});

describe("what a batch sends to the CLI", () => {
  it("is the plan form: verbs with times as strings", () => {
    expect(planFor([
      { verb: "move", ref: "#a", start: 1.25 },
      { verb: "trim", ref: "#b", end: 3 },
      { verb: "split", ref: "#c", at: 5 },
      { verb: "duplicate", ref: "#d" },
      { verb: "delete", ref: "#e" },
    ])).toEqual([
      { verb: "move", ref: "#a", time: "1.25" },
      { verb: "trim", ref: "#b", end: "3" },
      { verb: "split", ref: "#c", time: "5" },
      { verb: "duplicate", ref: "#d" },
      { verb: "delete", ref: "#e" },
    ]);
  });
});

describe("which lane moves are allowed", () => {
  const clips = [
    clip({ ref: "#a", id: "a", absStart: 0, absEnd: 2 }),
    clip({ ref: "#c", id: "c", absStart: 4, absEnd: 6 }),
    clip({ ref: "#d", id: "d", absStart: 1, absEnd: 4, trackIndex: 1 }),
  ];
  it("accepts a clip that fits, including one that exactly touches its neighbour", () => {
    expect(planLaneMoves(clips, [{ ref: "#c", track: 1 }])).toMatchObject({ ok: true });
    const touching = [...clips, clip({ ref: "#e", id: "e", absStart: 6, absEnd: 8, trackIndex: 1 })];
    expect(planLaneMoves(touching, [{ ref: "#c", track: 1 }])).toMatchObject({ ok: true });
  });
  it("refuses an overlap, with or without the other clip moving too, and a move that changes nothing", () => {
    expect(planLaneMoves(clips, [{ ref: "#a", track: 1 }])).toMatchObject({ ok: false, reason: expect.stringMatching(/overlap/) });
    expect(planLaneMoves(clips, [{ ref: "#a", track: 2 }, { ref: "#c", track: 2 }])).toMatchObject({ ok: true }); // far apart: both fit
    expect(planLaneMoves(clips, [{ ref: "#a", track: 0 }])).toMatchObject({ ok: false, reason: expect.stringMatching(/already/) });
    expect(planLaneMoves(clips, [{ ref: "#zzz", track: 1 }])).toMatchObject({ ok: false });
  });
  it("lets a clip leave a lane for one that a clip is leaving at the same moment", () => {
    // d goes up to lane 2 while a goes into lane 1: no overlap in the end state.
    expect(planLaneMoves(clips, [{ ref: "#d", track: 2 }, { ref: "#a", track: 1 }])).toMatchObject({ ok: true });
  });
});

describe("group edits and lane moves, through the real CLI", () => {
  let id = "";
  const index = () => readFileSync(join(projectPath(id), "index.html"), "utf8");
  const starts = async () => Object.fromEntries((await readTimeline(id)).clips.map((c) => [c.id, [c.start, c.duration, c.trackIndex]]));

  beforeAll(async () => {
    id = (await createProject({ name: "Groups", orientation: "landscape" })).id;
    writeFileSync(join(projectPath(id), "index.html"), INDEX);
  }, 120_000);

  it("moves several clips as one step that one undo reverses, and redo repeats", async () => {
    const res = await editTimeline(id, { op: "batch", edits: [{ verb: "move", ref: "#c", start: 5 }, { verb: "move", ref: "#b", start: 3 }, { verb: "move", ref: "#a", start: 1 }] });
    expect(res).toEqual({ ok: true });
    expect(await starts()).toMatchObject({ a: [1, 2, 0], b: [3, 2, 0], c: [5, 2, 0] });

    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect(await starts()).toMatchObject({ a: [0, 2, 0], b: [2, 2, 0], c: [4, 2, 0] }); // all three, one undo
    expect(await undoTimeline(id, "redo")).toEqual({ ok: true });
    expect(await starts()).toMatchObject({ a: [1, 2, 0], b: [3, 2, 0], c: [5, 2, 0] });
    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
  }, 180_000);

  it("applies all of a batch or none: one refused edit leaves every other clip where it was, and adds no undo step", async () => {
    const before = await starts();
    const htmlBefore = index();
    const undoable = (await readTimeline(id)).canUndo;
    // The first move is fine; the second lands b on c.
    const res = await editTimeline(id, { op: "batch", edits: [{ verb: "move", ref: "#a", start: 8 }, { verb: "move", ref: "#b", start: 3.5 }] });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/would overlap/);
    expect(res.ok === false && res.reason).not.toMatch(/^timeline apply/);
    expect(await starts()).toEqual(before);
    expect(index()).toBe(htmlBefore);
    expect((await readTimeline(id)).canUndo).toBe(undoable);
  }, 120_000);

  it("deletes and duplicates several clips in one step", async () => {
    const before = await starts();
    expect(await editTimeline(id, { op: "batch", edits: [{ verb: "delete", ref: "#a" }, { verb: "delete", ref: "#d" }] })).toEqual({ ok: true });
    expect(Object.keys(await starts()).sort()).toEqual(["b", "c"]);
    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect(await starts()).toEqual(before);
  }, 120_000);

  it("moves a clip to another lane, refuses a lane where it would overlap, and undo restores the file byte for byte", async () => {
    const htmlBefore = index();
    // c (4-6) fits in lane 1 next to d (1-4).
    expect(await editTimeline(id, { op: "lane", moves: [{ ref: "#c", track: 1 }] })).toEqual({ ok: true });
    expect((await starts()).c).toEqual([4, 2, 1]);
    expect(index()).toContain('id="c" class="clip" data-start="4" data-duration="2" data-track-index="1"');

    const refused = await editTimeline(id, { op: "lane", moves: [{ ref: "#a", track: 1 }] }); // a (0-2) overlaps d (1-4)
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toMatch(/overlap/);
    expect((await starts()).a).toEqual([0, 2, 0]);

    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
    expect(index()).toBe(htmlBefore);
    expect(await undoTimeline(id, "redo")).toEqual({ ok: true });
    expect((await starts()).c).toEqual([4, 2, 1]);
    expect(await undoTimeline(id, "undo")).toEqual({ ok: true });
  }, 180_000);

  it("can open a new lane by sending a clip to the next free number", async () => {
    expect(await editTimeline(id, { op: "lane", moves: [{ ref: "#b", track: 2 }] })).toEqual({ ok: true });
    expect((await starts()).b).toEqual([2, 2, 2]);
  }, 90_000);
});
