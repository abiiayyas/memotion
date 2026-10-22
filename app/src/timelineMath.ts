import type { TimelineClip } from "./types";

export const KIND_ORDER = ["graphics", "video", "audio", "captions"];

export interface Lane {
  key: string;
  label: string;
  trackKind: string;
  host: string | null;
  trackIndex: number;
  clips: TimelineClip[];
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Lanes are a kind (graphics, video, audio, captions), a host scene for clips inside one, and a number. */
export function buildLanes(clips: TimelineClip[]): Lane[] {
  const groups = new Map<string, Lane>();
  for (const c of clips) {
    const key = `${c.trackKind}|${c.host ?? ""}|${c.trackIndex}`;
    let g = groups.get(key);
    if (!g) {
      const name = c.trackKind.charAt(0).toUpperCase() + c.trackKind.slice(1);
      g = { key, label: c.host ? `${c.host} · ${c.trackIndex + 1}` : `${name} ${c.trackIndex + 1}`, trackKind: c.trackKind, host: c.host, trackIndex: c.trackIndex, clips: [] };
      groups.set(key, g);
    }
    g.clips.push(c);
  }
  const rank = (k: string): number => {
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...groups.values()].sort((a, b) => rank(a.trackKind) - rank(b.trackKind) || (a.host ?? "").localeCompare(b.host ?? "") || a.trackIndex - b.trackIndex);
}

/** The largest negative shift that keeps every clip at or after 0, and `delta` itself if it already does. */
export function clampDelta(clips: TimelineClip[], delta: number): number {
  const earliest = Math.min(...clips.map((c) => c.absStart));
  return Math.max(delta, -earliest);
}

/**
 * The moves that shift all `clips` by `delta` seconds, in an order the CLI accepts: the clip furthest in the direction
 * of travel goes first, so no clip lands on one that has not moved yet. Each start is local to the clip's own file.
 */
export function groupMoveEdits(clips: TimelineClip[], delta: number): { verb: "move"; ref: string; start: number }[] {
  const d = clampDelta(clips, delta);
  const ordered = [...clips].sort((a, b) => (d > 0 ? b.absStart - a.absStart : a.absStart - b.absStart));
  return ordered.map((c) => ({ verb: "move" as const, ref: c.ref, start: round3(Math.max(0, c.start + d)) }));
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Clips whose box touches the rectangle (content coordinates: x from the left edge, y below the top of the content). */
export function marqueeHits(lanes: Lane[], rect: Rect, geom: { pps: number; labelW: number; laneH: number; rulerH: number; clipTop: number; clipH: number }): string[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  const hits: string[] = [];
  lanes.forEach((lane, i) => {
    const y = geom.rulerH + i * geom.laneH + geom.clipTop;
    if (y + geom.clipH < top || y > bottom) return;
    for (const c of lane.clips) {
      const x = geom.labelW + c.absStart * geom.pps;
      const w = Math.max(6, (c.absEnd - c.absStart) * geom.pps);
      if (x + w >= left && x <= right) hits.push(c.ref);
    }
  });
  return hits;
}

/**
 * Where a clip dropped at lane row `row` (0 = first lane) would go, as a track number within its own kind:
 * a lane of the same kind and host, or a new lane after the last one when the pointer is below every lane.
 * Null when the row belongs to another kind (a graphic cannot go into an audio lane).
 */
export function laneTarget(lanes: Lane[], clip: TimelineClip, row: number): number | null {
  if (row >= lanes.length) {
    const same = lanes.filter((l) => l.trackKind === clip.trackKind && l.host === clip.host);
    return same.length === 0 ? null : Math.max(...same.map((l) => l.trackIndex)) + 1;
  }
  const lane = lanes[Math.max(0, row)];
  return lane && lane.trackKind === clip.trackKind && lane.host === clip.host ? lane.trackIndex : null;
}

/** All of `clips` share a kind and host, so one lane shift can apply to them all. */
export function sameLaneFamily(clips: TimelineClip[]): boolean {
  const first = clips[0];
  return first !== undefined && clips.every((c) => c.trackKind === first.trackKind && c.host === first.host);
}

/** A new zoom (pixels per second) and the scroll position that keeps the time under the cursor where it was. */
export function zoomAround(pps: number, factor: number, cursorX: number, scrollLeft: number, labelW: number, limits: { min: number; max: number }): { pps: number; scrollLeft: number } {
  const next = Math.max(limits.min, Math.min(limits.max, pps * factor));
  const time = (cursorX + scrollLeft - labelW) / pps;
  return { pps: next, scrollLeft: Math.max(0, labelW + time * next - cursorX) };
}
