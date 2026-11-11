import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Player } from "../player";
import { buildLanes, clampDelta, groupMoveEdits, laneTarget, marqueeHits, round3, sameLaneFamily, zoomAround, type Rect } from "../timelineMath";
import type { BatchEdit, EditOp, Project, TimelineClip, TimelineView } from "../types";
import { fmtTime } from "./Preview";
import { usePrefs } from "../prefs";

const LABEL_W = 108;
const LANE_H = 34;
const RULER_H = 24;
const CLIP_TOP = 4;
const CLIP_H = 26;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const SNAP_PX = 8;
const ZOOM = { min: 10, max: 400 };
const MOVE_THRESHOLD_PX = 3;

type DragMode = "move" | "trim-left" | "trim-right";

interface Drag {
  clip: TimelineClip;
  mode: DragMode;
  /** The clips that travel together (the whole selection when the grabbed clip is part of it). */
  group: TimelineClip[];
  startX: number;
  startY: number;
  /** Seconds, already snapped and kept at or after time zero. */
  delta: number;
  /** Lane shift for every clip of the group (0: stay). */
  laneShift: number;
  /** Row under the pointer for the drop highlight; equal to the lane count means "a new lane". */
  dropRow: number | null;
  moved: boolean;
}

interface Notice {
  text: string;
  action?: { label: string; run: () => void };
}

function clipLabel(c: TimelineClip): string {
  // Media shows its file name; a scene host's `src` is the scene file, which its id already names.
  if (c.src && !c.src.endsWith(".html")) return c.src.split("/").pop() ?? c.src;
  return c.id === c.tag ? `<${c.tag}>` : c.id;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function Timeline({
  project,
  player,
  reloadKey,
  onEdited,
  onAsk,
}: {
  project: Project;
  player: Player;
  reloadKey: number;
  onEdited: () => void;
  /** Queue a message for the director (used after a split, whose copy has no animation). */
  onAsk?: (text: string) => void;
}) {
  const { skip } = usePrefs();
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [pps, setPps] = useState(60);
  const [snapOn, setSnapOn] = useState(true);
  const [guide, setGuide] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const marqueeRef = useRef<{ rect: Rect; base: string[]; moved: boolean } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const pendingScroll = useRef<number | null>(null);
  const frame = 1 / project.fps;

  const refresh = useCallback(async () => {
    try {
      setView(await api.timeline(project.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  // A clip that no longer exists (deleted, or renamed by an edit) leaves the selection.
  useEffect(() => {
    if (!view) return;
    setSelection((cur) => {
      const alive = cur.filter((ref) => view.clips.some((c) => c.ref === ref));
      return alive.length === cur.length ? cur : alive;
    });
  }, [view]);

  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), notice.action ? 15_000 : 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // First load: fit the whole video into the visible width.
  useEffect(() => {
    if (!view || fitted.current || !scroller.current) return;
    fitted.current = true;
    setPps(Math.max(12, Math.min(200, (scroller.current.clientWidth - LABEL_W - 32) / Math.max(view.duration, 1))));
  }, [view]);

  const lanes = useMemo(() => buildLanes(view?.clips ?? []), [view]);
  const contentEnd = Math.max(view?.duration ?? 0, ...(view?.clips.map((c) => c.absEnd) ?? [0]));
  const width = LABEL_W + (contentEnd + 1.5) * pps;
  const selected = useMemo(() => (view?.clips ?? []).filter((c) => selection.includes(c.ref)), [view, selection]);
  const sel = selected.length === 1 ? selected[0] : undefined;

  // Keep the playhead on screen while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !player.playing) return;
    const x = LABEL_W + player.time * pps;
    if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft + LABEL_W) el.scrollLeft = Math.max(0, x - LABEL_W - 40);
  }, [player.time, player.playing, pps]);

  // After a wheel zoom, put the scroll position where the zoom wanted it once the new width is laid out.
  useEffect(() => {
    if (pendingScroll.current === null || !scroller.current) return;
    scroller.current.scrollLeft = pendingScroll.current;
    pendingScroll.current = null;
  }, [pps]);

  // Pinch or Ctrl/⌘ + wheel zooms around the pointer. A plain wheel scrolls as usual.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const z = zoomAround(pps, Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, el.scrollLeft, LABEL_W, ZOOM);
      pendingScroll.current = z.scrollLeft;
      setPps(z.pps);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pps]);

  /** Run an edit. Resolves true when it was applied; a refusal shows its reason and resolves false. */
  const run = useCallback(
    async (op: EditOp, optimistic?: (clips: TimelineClip[]) => TimelineClip[]): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await api.editTimeline(project.id, op);
        if (!res.ok) {
          setNotice({ text: res.fix ? `${res.reason}. ${res.fix}` : res.reason });
          return false;
        }
        if (optimistic) setView((v) => (v ? { ...v, clips: optimistic(v.clips), canUndo: true, canRedo: false } : v));
        player.rememberTime();
        onEdited();
        return true;
      } catch (e) {
        setNotice({ text: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project.id, player, onEdited],
  );

  const undoRedo = useCallback(
    async (direction: "undo" | "redo") => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await api.undoTimeline(project.id, direction);
        if (!res.ok) setNotice({ text: res.reason });
        else {
          player.rememberTime();
          onEdited();
        }
      } catch (e) {
        setNotice({ text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    },
    [busy, project.id, player, onEdited],
  );

  // ── editing the selection ───────────────────────────────────────────────────────────────

  const shiftClips = useCallback(
    (clips: TimelineClip[], delta: number) => {
      const d = clampDelta(clips, delta);
      if (Math.abs(d) < frame / 2) return Promise.resolve(false);
      const moved = new Map(clips.map((c) => [c.ref, c]));
      const optimistic = (all: TimelineClip[]) =>
        all.map((c) => (moved.has(c.ref) ? { ...c, start: c.start + d, end: c.end + d, absStart: c.absStart + d, absEnd: c.absEnd + d } : c));
      const [only] = clips;
      if (clips.length === 1 && only) return run({ op: "move", ref: only.ref, start: round3(Math.max(0, only.start + d)) }, optimistic);
      return run({ op: "batch", edits: groupMoveEdits(clips, d) }, optimistic);
    },
    [frame, run],
  );

  const eachOrBatch = useCallback(
    (clips: TimelineClip[], verb: "delete" | "duplicate") => {
      const edits: BatchEdit[] = clips.map((c) => ({ verb, ref: c.ref }));
      const [only] = clips;
      return clips.length === 1 && only ? run({ op: verb, ref: only.ref }) : run({ op: "batch", edits });
    },
    [run],
  );

  const splitAtPlayhead = useCallback(async () => {
    const t = player.time;
    const hit = selected.filter((c) => t > c.absStart + frame / 2 && t < c.absEnd - frame / 2);
    if (hit.length === 0) {
      setNotice({ text: selected.length === 0 ? "Select a clip, then put the playhead inside it to split it." : "Move the playhead inside a selected clip to split it." });
      return;
    }
    const edits: BatchEdit[] = hit.map((c) => ({ verb: "split", ref: c.ref, at: round3(t - c.offset) }));
    const [only] = hit;
    const ok = hit.length === 1 && only ? await run({ op: "split", ref: only.ref, at: edits[0]?.verb === "split" ? edits[0].at : 0 }) : await run({ op: "batch", edits });
    if (!ok) return;
    const names = hit.map((c) => `“${clipLabel(c)}”`).join(", ");
    setNotice({
      text: `Split ${names} at ${fmtTime(t)}. The new part is a copy: code that animates a clip by its id does not animate the copy.`,
      action: onAsk
        ? {
            label: "Ask the director to animate the new part",
            run: () => {
              onAsk(`I split ${names} at ${t.toFixed(1)} s on the timeline. The second part is a copy of the element, and GSAP code that targets the original by its id does not animate the copy. Please give the second part the same animation as the first, and keep everything else as it is.`);
              setNotice(null);
            },
          }
        : undefined,
    });
  }, [player.time, selected, frame, run, onAsk]);

  function onKey(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.metaKey || e.ctrlKey;
    if (busy) return;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void undoRedo(e.shiftKey ? "redo" : "undo");
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection((view?.clips ?? []).map((c) => c.ref));
    } else if (e.key === "Escape") {
      setSelection([]);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length > 0) {
      e.preventDefault();
      void eachOrBatch(selected, "delete");
    } else if (e.key === "s" && !mod) void splitAtPlayhead();
    else if (e.key === "d" && selected.length > 0 && !mod) void eachOrBatch(selected, "duplicate");
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      // With clips selected the arrows nudge them; with none they move the playhead (Shift: by the skip distance).
      if (selected.length > 0) void shiftClips(selected, (e.shiftKey ? 1 : frame) * dir);
      else player.seek(Math.max(0, Math.min(view?.duration ?? 0, player.time + (e.shiftKey ? skip : frame) * dir)));
    }
  }

  // ── pointer: clips ──────────────────────────────────────────────────────────────────────

  /** Snap a project time to a nearby clip edge, the playhead, 0 or the end; otherwise to the frame grid. Alt turns it off. */
  const snap = useCallback(
    (t: number, ignore: Set<string>, off: boolean): { t: number; point: number | null } => {
      if (!snapOn || off) return { t, point: null };
      const points = [0, player.time, view?.duration ?? 0];
      for (const c of view?.clips ?? []) if (!ignore.has(c.ref)) points.push(c.absStart, c.absEnd);
      let best: number | null = null;
      let dist = SNAP_PX / pps;
      for (const p of points) {
        if (Math.abs(p - t) < dist) {
          dist = Math.abs(p - t);
          best = p;
        }
      }
      return best === null ? { t: Math.round(t / frame) * frame, point: null } : { t: best, point: best };
    },
    [snapOn, view, player.time, pps, frame],
  );

  function beginDrag(e: React.PointerEvent, clip: TimelineClip, mode: DragMode) {
    if (busy || e.button !== 0) return;
    e.stopPropagation();
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      // Adding to or taking from the selection; no drag starts.
      setSelection((cur) => (cur.includes(clip.ref) ? cur.filter((r) => r !== clip.ref) : [...cur, clip.ref]));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const keep = mode === "move" && selection.includes(clip.ref);
    const refs = keep ? selection : [clip.ref];
    setSelection(refs);
    const group = (view?.clips ?? []).filter((c) => refs.includes(c.ref));
    const d: Drag = { clip, mode, group, startX: e.clientX, startY: e.clientY, delta: 0, laneShift: 0, dropRow: null, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const raw = (e.clientX - d.startX) / pps;
    const c = d.clip;
    const ignore = new Set(d.group.map((x) => x.ref));
    let delta: number;
    let point: number | null = null;
    if (d.mode === "move") {
      const s = snap(c.absStart + raw, ignore, e.altKey);
      // A group snaps by whichever of its edges is closest: try the grabbed clip's start and end.
      const s2 = snap(c.absEnd + raw, ignore, e.altKey);
      const useEnd = s2.point !== null && (s.point === null || Math.abs(s2.t - (c.absEnd + raw)) < Math.abs(s.t - (c.absStart + raw)));
      delta = useEnd ? s2.t - c.absEnd : s.t - c.absStart;
      point = useEnd ? s2.point : s.point;
      delta = clampDelta(d.group, delta);
    } else if (d.mode === "trim-left") {
      const s = snap(c.absStart + raw, ignore, e.altKey);
      delta = Math.max(-c.absStart, Math.min(s.t - c.absStart, c.duration - frame));
      point = s.point;
    } else {
      const s = snap(c.absEnd + raw, ignore, e.altKey);
      delta = Math.max(s.t - c.absEnd, frame - c.duration);
      point = s.point;
    }
    setGuide(point);

    let laneShift = 0;
    let dropRow: number | null = null;
    if (d.mode === "move" && Math.abs(e.clientY - d.startY) > LANE_H / 2 && sameLaneFamily(d.group)) {
      const top = content.current?.getBoundingClientRect().top ?? 0;
      const row = Math.max(0, Math.floor((e.clientY - top - RULER_H) / LANE_H));
      const target = laneTarget(lanes, c, row);
      if (target !== null && d.group.every((x) => x.trackIndex + (target - c.trackIndex) >= 0)) {
        laneShift = target - c.trackIndex;
        dropRow = Math.min(row, lanes.length);
      }
    }
    const next = { ...d, delta, laneShift, dropRow, moved: d.moved || Math.abs(e.clientX - d.startX) > MOVE_THRESHOLD_PX || Math.abs(e.clientY - d.startY) > MOVE_THRESHOLD_PX };
    dragRef.current = next;
    setDrag(next);
  }

  async function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setGuide(null);
    if (!d?.moved) {
      // A plain click on a clip that was one of several selects just that clip (the group only stays for a drag).
      if (d && d.mode === "move" && d.group.length > 1) setSelection([d.clip.ref]);
      return;
    }
    const c = d.clip;
    const delta = round3(d.delta);
    if (d.mode === "move") {
      const horizontal = Math.abs(delta) >= frame / 2;
      if (horizontal && !(await shiftClips(d.group, delta))) return;
      if (d.laneShift !== 0) {
        const moves = d.group.map((x) => ({ ref: x.ref, track: x.trackIndex + d.laneShift }));
        await run({ op: "lane", moves }, (all) => all.map((x) => (moves.some((m) => m.ref === x.ref) ? { ...x, trackIndex: x.trackIndex + d.laneShift } : x)));
      }
    } else if (Math.abs(delta) >= frame / 2) {
      if (d.mode === "trim-left") {
        await run({ op: "trim", ref: c.ref, start: round3(c.start + delta), end: round3(c.end) }, (all) =>
          all.map((x) => (x.ref === c.ref ? { ...x, start: x.start + delta, duration: x.duration - delta, absStart: x.absStart + delta } : x)),
        );
      } else {
        await run({ op: "trim", ref: c.ref, end: round3(c.end + delta) }, (all) =>
          all.map((x) => (x.ref === c.ref ? { ...x, end: x.end + delta, duration: x.duration + delta, absEnd: x.absEnd + delta } : x)),
        );
      }
    }
  }

  // ── pointer: empty space (click to seek and deselect, drag to select) ───────────────────

  function beginMarquee(e: React.PointerEvent) {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest(".tl-clip, .tl-ruler, .tl-label"))) return;
    const box = content.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    marqueeRef.current = { rect: { x0: x, y0: y, x1: x, y1: y }, base: additive ? selection : [], moved: false };
  }

  function moveMarquee(e: React.PointerEvent) {
    const m = marqueeRef.current;
    const box = content.current?.getBoundingClientRect();
    if (!m || !box) return;
    const rect = { ...m.rect, x1: e.clientX - box.left, y1: e.clientY - box.top };
    const moved = m.moved || Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) > 4;
    marqueeRef.current = { ...m, rect, moved };
    if (!moved) return;
    setMarquee(rect);
    const hits = marqueeHits(lanes, rect, { pps, labelW: LABEL_W, laneH: LANE_H, rulerH: RULER_H, clipTop: CLIP_TOP, clipH: CLIP_H });
    setSelection([...new Set([...m.base, ...hits])]);
  }

  function endMarquee() {
    const m = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!m || m.moved) return;
    // A plain click on empty space: deselect (unless adding) and put the playhead there.
    if (m.base.length === 0) setSelection([]);
    if (m.rect.x0 > LABEL_W) player.seek(Math.max(0, Math.min(view?.duration ?? 0, round3((m.rect.x0 - LABEL_W) / pps))));
  }

  function seekFromRuler(e: React.PointerEvent) {
    const el = scroller.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W;
    player.seek(Math.max(0, Math.min(view?.duration ?? 0, round3(x / pps))));
  }

  const tickStep = TICK_STEPS.find((s) => s * pps >= 64) ?? TICK_STEPS[TICK_STEPS.length - 1] ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= contentEnd + 1; t += tickStep) ticks.push(round3(t));

  const setLength = (value: string) => {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0.5 && seconds !== view?.duration) void run({ op: "length", seconds });
  };

  const fit = () => scroller.current && view && setPps(Math.max(12, (scroller.current.clientWidth - LABEL_W - 32) / Math.max(view.duration, 1)));
  const count = selected.length;
  const span = count > 1 ? { from: Math.min(...selected.map((c) => c.absStart)), to: Math.max(...selected.map((c) => c.absEnd)) } : null;
  const dragging = drag?.moved ? drag : null;
  const currentRow = dragging ? lanes.findIndex((l) => l.key === `${dragging.clip.trackKind}|${dragging.clip.host ?? ""}|${dragging.clip.trackIndex}`) : -1;

  return (
    <div className="timeline" tabIndex={0} onKeyDown={onKey} aria-label="Timeline">
      <div className="tl-bar">
        <button onClick={() => void undoRedo("undo")} disabled={busy || !view?.canUndo} title="Undo (⌘Z)">↶</button>
        <button onClick={() => void undoRedo("redo")} disabled={busy || !view?.canRedo} title="Redo (⇧⌘Z)">↷</button>
        <span className="sep" />
        <button onClick={() => void splitAtPlayhead()} disabled={busy || count === 0} title="Split at the playhead (S)">Split</button>
        <button onClick={() => void eachOrBatch(selected, "duplicate")} disabled={busy || count === 0} title="Duplicate (D)">Duplicate</button>
        <button onClick={() => void eachOrBatch(selected, "delete")} disabled={busy || count === 0} title="Delete (⌫)">Delete{count > 1 ? ` ${count}` : ""}</button>
        <span className="sep" />
        <button className={snapOn ? "toggle on" : "toggle"} aria-pressed={snapOn} onClick={() => setSnapOn((s) => !s)} title="Snap to clip edges, the playhead and the ends. Hold Alt while dragging to skip it.">
          Snap
        </button>
        <label className="len">
          Length
          <input key={view?.duration} type="number" min={0.5} step={0.5} defaultValue={view?.duration} onBlur={(e) => setLength(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} disabled={busy || !view} />
          s
        </label>
        <span className="grow" />
        <button onClick={() => setPps((p) => Math.max(ZOOM.min, p / 1.5))} title="Zoom out (or ⌘ + scroll)">−</button>
        <button onClick={() => setPps((p) => Math.min(ZOOM.max, p * 1.5))} title="Zoom in (or ⌘ + scroll)">+</button>
        <button onClick={fit} title="Fit the whole video">Fit</button>
      </div>

      {notice && (
        <div className="tl-notice" role="status">
          {notice.text}
          {notice.action && (
            <button className="link" onClick={notice.action.run} style={{ marginLeft: 8 }}>
              {notice.action.label}
            </button>
          )}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}

      <div className="tl-scroll" ref={scroller}>
        <div
          className="tl-content"
          ref={content}
          style={{ width }}
          onPointerDown={beginMarquee}
          onPointerMove={moveMarquee}
          onPointerUp={endMarquee}
          onPointerCancel={endMarquee}
        >
          <div className="tl-ruler" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromRuler(e); }} onPointerMove={(e) => e.buttons === 1 && seekFromRuler(e)}>
            <div className="tl-corner" style={{ width: LABEL_W }} />
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: LABEL_W + t * pps }}>
                {tickStep < 1 ? t.toFixed(1) : fmtTime(t)}
              </span>
            ))}
            {view && view.duration > 0 && <div className="tl-end" style={{ left: LABEL_W + view.duration * pps }} title="End of video" />}
          </div>

          {lanes.map((lane, row) => (
            <div key={lane.key} className={`tl-lane ${dragging?.dropRow === row ? "drop" : ""}`} style={{ height: LANE_H }}>
              <div className="tl-label" style={{ width: LABEL_W }} title={lane.label}>{lane.label}</div>
              {lane.clips.map((c) => {
                const inGroup = dragging?.group.some((g) => g.ref === c.ref) ?? false;
                const grabbed = dragging?.clip.ref === c.ref;
                const dl = dragging && (dragging.mode === "move" ? inGroup : grabbed && dragging.mode === "trim-left") ? dragging.delta : 0;
                const dr = dragging && (dragging.mode === "move" ? inGroup : grabbed && dragging.mode === "trim-right") ? dragging.delta : 0;
                const left = LABEL_W + (c.absStart + dl) * pps;
                const w = Math.max(6, (c.absEnd + dr - (c.absStart + dl)) * pps);
                const dy = dragging && dragging.mode === "move" && inGroup && dragging.dropRow !== null ? (dragging.dropRow - currentRow) * LANE_H : 0;
                const over = view ? c.absEnd > view.duration + 1e-6 : false;
                return (
                  <div
                    key={c.ref}
                    className={`tl-clip k-${c.trackKind} ${c.nested ? "nested" : ""} ${selection.includes(c.ref) ? "sel" : ""} ${inGroup ? "dragging" : ""} ${over ? "over" : ""}`}
                    style={{ left, width: w, transform: dy ? `translateY(${dy}px)` : undefined }}
                    onPointerDown={(e) => beginDrag(e, c, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={() => void endDrag()}
                    onPointerCancel={() => void endDrag()}
                    title={`${clipLabel(c)}  ${fmtTime(c.absStart)}–${fmtTime(c.absEnd)} (${round3(c.duration)}s)${c.warnings.length ? `\n⚠ ${c.warnings.join("\n⚠ ")}` : ""}`}
                  >
                    <span className="edge l" onPointerDown={(e) => beginDrag(e, c, "trim-left")} />
                    <span className="name">{c.warnings.length > 0 ? "⚠ " : ""}{clipLabel(c)}</span>
                    <span className="edge r" onPointerDown={(e) => beginDrag(e, c, "trim-right")} />
                  </div>
                );
              })}
            </div>
          ))}
          {dragging && dragging.mode === "move" && dragging.laneShift !== 0 && (
            <div className={`tl-lane ghost ${dragging.dropRow === lanes.length ? "drop" : ""}`} style={{ height: LANE_H }}>
              <div className="tl-label" style={{ width: LABEL_W }}>New lane</div>
            </div>
          )}
          {view && lanes.length === 0 && <div className="empty tl-empty">No timed clips yet. Ask the director to build the video, then edit it here.</div>}
          {guide !== null && <div className="tl-guide" style={{ left: LABEL_W + guide * pps }} />}
          {marquee && (
            <div className="tl-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
          )}
          <div className="tl-playhead" style={{ left: LABEL_W + player.time * pps }} />
        </div>
      </div>

      {count > 1 && span && (
        <div className="tl-props">
          <strong>{plural(count, "clip")} selected</strong>
          <span className="muted">{fmtTime(span.from)}–{fmtTime(span.to)}. Drag any of them to move all; ⌫ deletes, D duplicates, ← → nudge.</span>
          <button className="link" onClick={() => setSelection([])}>Clear selection</button>
        </div>
      )}
      {sel && (
        <div className="tl-props">
          <strong>{clipLabel(sel)}</strong>
          <span className="muted">{sel.file}{sel.host ? ` · in ${sel.host}` : ""}</span>
          <label>
            Start
            <input
              key={`s-${sel.ref}-${sel.absStart}`}
              type="number"
              step={frame}
              min={0}
              defaultValue={round3(sel.absStart)}
              onBlur={(e) => {
                const abs = Number(e.target.value);
                if (Number.isFinite(abs) && Math.abs(abs - sel.absStart) > 1e-6) void run({ op: "move", ref: sel.ref, start: round3(Math.max(0, abs - sel.offset)) });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={busy}
            />
          </label>
          <label>
            Duration
            <input
              key={`d-${sel.ref}-${sel.duration}`}
              type="number"
              step={frame}
              min={frame}
              defaultValue={round3(sel.duration)}
              onBlur={(e) => {
                const dur = Number(e.target.value);
                if (Number.isFinite(dur) && dur >= frame && Math.abs(dur - sel.duration) > 1e-6) void run({ op: "trim", ref: sel.ref, end: round3(sel.start + dur) });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              disabled={busy}
            />
          </label>
          {sel.warnings.length > 0 && <span className="warn" title={sel.warnings.join("\n")}>⚠ {sel.warnings.length} warning{sel.warnings.length === 1 ? "" : "s"}</span>}
        </div>
      )}
    </div>
  );
}
