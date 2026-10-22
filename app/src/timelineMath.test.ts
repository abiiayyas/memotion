import { describe, expect, it } from "vitest";
import { buildLanes, clampDelta, groupMoveEdits, laneTarget, marqueeHits, sameLaneFamily, zoomAround } from "./timelineMath";
import type { TimelineClip } from "./types";

const clip = (id: string, absStart: number, absEnd: number, over: Partial<TimelineClip> = {}): TimelineClip => ({
  ref: `#${id}`, id, tag: "h1", trackKind: "graphics", trackIndex: 0, start: absStart, duration: absEnd - absStart, end: absEnd, absStart, absEnd,
  file: "index.html", src: null, nested: false, host: null, offset: 0, mediaStart: null, warnings: [], ...over,
});

describe("lanes", () => {
  it("orders by kind, then host, then number, and names them", () => {
    const lanes = buildLanes([
      clip("v", 0, 1, { trackKind: "audio" }),
      clip("b", 0, 1, { trackIndex: 1 }),
      clip("a", 0, 1),
      clip("n", 0, 1, { host: "intro", nested: true }),
      clip("c", 0, 1, { trackKind: "captions" }),
    ]);
    expect(lanes.map((l) => l.label)).toEqual(["Graphics 1", "Graphics 2", "intro · 1", "Audio 1", "Captions 1"]);
  });
});

describe("group moves", () => {
  const abc = [clip("a", 0, 2), clip("b", 2, 4), clip("c", 4, 6)];

  it("moves the clip furthest in the direction of travel first, so none lands on one that has not moved", () => {
    expect(groupMoveEdits(abc, 1).map((e) => e.ref)).toEqual(["#c", "#b", "#a"]);
    expect(groupMoveEdits(abc, -1.5).map((e) => e.ref)).toEqual(["#a", "#b", "#c"]);
  });

  it("never pushes a clip before time zero: the whole group stops when the first one reaches it", () => {
    expect(clampDelta(abc, -5)).toBe(-0);
    const edits = groupMoveEdits([clip("b", 2, 4), clip("c", 4, 6)], -5);
    expect(edits.map((e) => e.start)).toEqual([0, 2]); // the gap between them is kept
  });

  it("uses each clip's own local start, so a clip inside a scene moves by the same amount", () => {
    const nested = clip("t", 6.5, 9.5, { start: 0.5, offset: 6, nested: true, host: "intro", file: "compositions/intro.html" });
    expect(groupMoveEdits([nested], 1)[0]).toEqual({ verb: "move", ref: "#t", start: 1.5 });
  });
});

describe("marquee selection", () => {
  const geom = { pps: 100, labelW: 100, laneH: 34, rulerH: 24, clipTop: 4, clipH: 26 };
  const lanes = buildLanes([clip("a", 0, 2), clip("b", 3, 4), clip("d", 1, 2, { trackIndex: 1 })]);

  it("selects the clips the rectangle touches, in the lanes it crosses, however it was dragged", () => {
    // Lane 0 spans y 28..54, lane 1 spans y 62..88. x 100 is time 0.
    expect(marqueeHits(lanes, { x0: 150, y0: 30, x1: 250, y1: 50 }, geom)).toEqual(["#a"]);
    expect(marqueeHits(lanes, { x0: 250, y0: 50, x1: 150, y1: 30 }, geom)).toEqual(["#a"]); // reversed corners
    expect(marqueeHits(lanes, { x0: 150, y0: 30, x1: 450, y1: 90 }, geom).sort()).toEqual(["#a", "#b", "#d"]);
    expect(marqueeHits(lanes, { x0: 600, y0: 30, x1: 700, y1: 90 }, geom)).toEqual([]);
  });

  it("misses a lane the rectangle only grazes between clips", () => {
    expect(marqueeHits(lanes, { x0: 150, y0: 56, x1: 250, y1: 60 }, geom)).toEqual([]); // the gap between lane 0 and lane 1
  });
});

describe("where a dragged clip can be dropped", () => {
  const lanes = buildLanes([clip("a", 0, 1), clip("d", 1, 2, { trackIndex: 1 }), clip("s", 0, 3, { trackKind: "audio" })]);
  const a = clip("a", 0, 1);

  it("allows a lane of its own kind, and not one of another kind", () => {
    expect(laneTarget(lanes, a, 1)).toBe(1);
    expect(laneTarget(lanes, a, 0)).toBe(0);
    expect(laneTarget(lanes, a, 2)).toBeNull(); // the audio lane
  });

  it("opens the next free lane when dropped below all of them, and never for a kind with no lane", () => {
    expect(laneTarget(lanes, a, 3)).toBe(2);
    expect(laneTarget([], a, 0)).toBeNull();
  });

  it("lets a group shift lanes only when its clips are of one kind and host", () => {
    expect(sameLaneFamily([clip("a", 0, 1), clip("b", 1, 2)])).toBe(true);
    expect(sameLaneFamily([clip("a", 0, 1), clip("s", 0, 1, { trackKind: "audio" })])).toBe(false);
    expect(sameLaneFamily([clip("a", 0, 1), clip("n", 0, 1, { host: "intro" })])).toBe(false);
    expect(sameLaneFamily([])).toBe(false);
  });
});

describe("zooming under the cursor", () => {
  it("keeps the moment under the pointer where it was, and respects the limits", () => {
    // Cursor at x=300 sees time (300 + 50 - 100) / 100 = 2.5 s.
    const z = zoomAround(100, 2, 300, 50, 100, { min: 10, max: 400 });
    expect(z.pps).toBe(200);
    expect((300 + z.scrollLeft - 100) / z.pps).toBeCloseTo(2.5, 9);
    expect(zoomAround(300, 2, 300, 0, 100, { min: 10, max: 400 }).pps).toBe(400);
    expect(zoomAround(12, 0.1, 300, 0, 100, { min: 10, max: 400 }).pps).toBe(10);
    expect(zoomAround(100, 0.5, 120, 0, 100, { min: 10, max: 400 }).scrollLeft).toBeGreaterThanOrEqual(0);
  });
});
