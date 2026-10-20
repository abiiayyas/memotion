import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Player } from "../player";
import type { EditOp, Project, TimelineClip, TimelineView } from "../types";
import { fmtTime } from "./Preview";

const LABEL_W = 108;
const LANE_H = 34;
const KIND_ORDER = ["graphics", "video", "audio", "captions"];
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const SNAP_PX = 8;

interface Lane {
  key: string;
  label: string;
  clips: TimelineClip[];
}

type DragMode = "move" | "trim-left" | "trim-right";

interface Drag {
  clip: TimelineClip;
  mode: DragMode;
  startX: number;
  /** Seconds, already snapped. */
  delta: number;
  moved: boolean;
}

function buildLanes(clips: TimelineClip[]): Lane[] {
  const groups = new Map<string, Lane & { order: [number, string, number] }>();
  for (const c of clips) {
    const key = `${c.trackKind}|${c.host ?? ""}|${c.trackIndex}`;
    let g = groups.get(key);
    if (!g) {
      const kindRank = KIND_ORDER.indexOf(c.trackKind);
      const name = c.trackKind.charAt(0).toUpperCase() + c.trackKind.slice(1);
      g = {
        key,
        label: c.host ? `${c.host} · ${c.trackIndex + 1}` : `${name} ${c.trackIndex + 1}`,
        clips: [],
        order: [kindRank < 0 ? KIND_ORDER.length : kindRank, c.host ?? "", c.trackIndex],
      };
      groups.set(key, g);
    }
    g.clips.push(c);
  }
  return [...groups.values()].sort(
    (a, b) => a.order[0] - b.order[0] || a.order[1].localeCompare(b.order[1]) || a.order[2] - b.order[2],
  );
}

function clipLabel(c: TimelineClip): string {
  // Media shows its file name; a scene host's `src` is the scene file, which its id already names.
  if (c.src && !c.src.endsWith(".html")) return c.src.split("/").pop() ?? c.src;
  return c.id === c.tag ? `<${c.tag}>` : c.id;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function Timeline({
  project,
  player,
  reloadKey,
  onEdited,
}: {
  project: Project;
  player: Player;
  reloadKey: number;
  onEdited: () => void;
}) {
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pps, setPps] = useState(60);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
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

  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), 6000);
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
  const sel = view?.clips.find((c) => c.ref === selected) ?? null;

  // Keep the playhead on screen while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !player.playing) return;
    const x = LABEL_W + player.time * pps;
    if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft + LABEL_W) el.scrollLeft = Math.max(0, x - LABEL_W - 40);
  }, [player.time, player.playing, pps]);

  const run = useCallback(
    async (op: EditOp, optimistic?: (c: TimelineClip) => TimelineClip) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await api.editTimeline(project.id, op);
        if (!res.ok) {
          setNotice(res.fix ? `${res.reason}. ${res.fix}` : res.reason);
          return;
        }
        if (optimistic && "ref" in op) {
          setView((v) => (v ? { ...v, clips: v.clips.map((c) => (c.ref === op.ref ? optimistic(c) : c)), canUndo: true, canRedo: false } : v));
        }
        player.rememberTime();
        onEdited();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, project.id, player, onEdited],
  );

  const undoRedo = useCallback(
    async (direction: "undo" | "redo") => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await api.undoTimeline(project.id, direction);
        if (!res.ok) setNotice(res.reason);
        else {
          player.rememberTime();
          onEdited();
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, project.id, player, onEdited],
  );

  /** Snap a project time to a nearby clip edge, the playhead, or the frame grid. */
  const snap = useCallback(
    (t: number, ignore: TimelineClip): number => {
      const points = [0, player.time, view?.duration ?? 0];
      for (const c of view?.clips ?? []) if (c.ref !== ignore.ref) points.push(c.absStart, c.absEnd);
      let best = t;
      let dist = SNAP_PX / pps;
      for (const p of points) {
        if (Math.abs(p - t) < dist) {
          dist = Math.abs(p - t);
          best = p;
        }
      }
      return best === t ? Math.round(t / frame) * frame : best;
    },
    [view, player.time, pps, frame],
  );

  function beginDrag(e: React.PointerEvent, clip: TimelineClip, mode: DragMode) {
    if (busy || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(clip.ref);
    const d: Drag = { clip, mode, startX: e.clientX, delta: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  }

  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const raw = (e.clientX - d.startX) / pps;
    const c = d.clip;
    // Snap the edge that is actually moving, then derive the delta back from it.
    let delta: number;
    if (d.mode === "move") delta = snap(c.absStart + raw, c) - c.absStart;
    else if (d.mode === "trim-left") delta = Math.min(snap(c.absStart + raw, c) - c.absStart, c.duration - frame);
    else delta = Math.max(snap(c.absEnd + raw, c) - c.absEnd, frame - c.duration);
    if (d.mode !== "trim-right") delta = Math.max(delta, -c.absStart);
    const next = { ...d, delta, moved: d.moved || Math.abs(e.clientX - d.startX) > 3 };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d?.moved || Math.abs(d.delta) < frame / 2) return;
    const c = d.clip;
    const delta = round3(d.delta);
    if (d.mode === "move") {
      void run({ op: "move", ref: c.ref, start: round3(c.start + delta) }, (x) => ({
        ...x,
        start: x.start + delta,
        end: x.end + delta,
        absStart: x.absStart + delta,
        absEnd: x.absEnd + delta,
      }));
    } else if (d.mode === "trim-left") {
      void run({ op: "trim", ref: c.ref, start: round3(c.start + delta), end: round3(c.end) }, (x) => ({
        ...x,
        start: x.start + delta,
        duration: x.duration - delta,
        absStart: x.absStart + delta,
      }));
    } else {
      void run({ op: "trim", ref: c.ref, end: round3(c.end + delta) }, (x) => ({
        ...x,
        end: x.end + delta,
        duration: x.duration + delta,
        absEnd: x.absEnd + delta,
      }));
    }
  }

  function splitAtPlayhead() {
    if (!sel) return;
    const at = round3(player.time - sel.offset);
    if (at <= sel.start + frame / 2 || at >= sel.end - frame / 2) {
      setNotice("Move the playhead inside the selected clip to split it.");
      return;
    }
    void run({ op: "split", ref: sel.ref, at });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void undoRedo(e.shiftKey ? "redo" : "undo");
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault();
      void run({ op: "delete", ref: sel.ref });
    } else if (e.key === "s" && sel && !mod) splitAtPlayhead();
    else if (e.key === "d" && sel && !mod) void run({ op: "duplicate", ref: sel.ref });
    else if (e.key === " ") {
      e.preventDefault();
      player.toggle();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && sel) {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : frame) * (e.key === "ArrowLeft" ? -1 : 1);
      const start = round3(Math.max(0, sel.start + step));
      void run({ op: "move", ref: sel.ref, start }, (x) => ({ ...x, start, end: start + x.duration, absStart: start + x.offset, absEnd: start + x.duration + x.offset }));
    }
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

  return (
    <div className="timeline" tabIndex={0} onKeyDown={onKey} aria-label="Timeline">
      <div className="tl-bar">
        <button onClick={() => void undoRedo("undo")} disabled={busy || !view?.canUndo} title="Undo (⌘Z)">↶</button>
        <button onClick={() => void undoRedo("redo")} disabled={busy || !view?.canRedo} title="Redo (⇧⌘Z)">↷</button>
        <span className="sep" />
        <button onClick={splitAtPlayhead} disabled={busy || !sel} title="Split at playhead (S)">Split</button>
        <button onClick={() => sel && void run({ op: "duplicate", ref: sel.ref })} disabled={busy || !sel} title="Duplicate (D)">Duplicate</button>
        <button onClick={() => sel && void run({ op: "delete", ref: sel.ref })} disabled={busy || !sel} title="Delete (⌫)">Delete</button>
        <span className="sep" />
        <label className="len">
          Length
          <input
            key={view?.duration}
            type="number"
            min={0.5}
            step={0.5}
            defaultValue={view?.duration}
            onBlur={(e) => setLength(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            disabled={busy || !view}
          />
          s
        </label>
        <span className="grow" />
        <button onClick={() => setPps((p) => Math.max(10, p / 1.5))} title="Zoom out">−</button>
        <button onClick={() => setPps((p) => Math.min(400, p * 1.5))} title="Zoom in">+</button>
        <button
          onClick={() => scroller.current && view && setPps(Math.max(12, (scroller.current.clientWidth - LABEL_W - 32) / Math.max(view.duration, 1)))}
          title="Fit the whole video"
        >
          Fit
        </button>
      </div>

      {notice && <div className="tl-notice" role="status">{notice}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-content" style={{ width }}>
          <div className="tl-ruler" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromRuler(e); }} onPointerMove={(e) => e.buttons === 1 && seekFromRuler(e)}>
            <div className="tl-corner" style={{ width: LABEL_W }} />
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: LABEL_W + t * pps }}>
                {tickStep < 1 ? t.toFixed(1) : fmtTime(t)}
              </span>
            ))}
            {view && view.duration > 0 && <div className="tl-end" style={{ left: LABEL_W + view.duration * pps }} title="End of video" />}
          </div>

          {lanes.map((lane) => (
            <div key={lane.key} className="tl-lane" style={{ height: LANE_H }}>
              <div className="tl-label" style={{ width: LABEL_W }} title={lane.label}>{lane.label}</div>
              {lane.clips.map((c) => {
                const d = drag?.clip.ref === c.ref ? drag : null;
                const dl = d && d.mode !== "trim-right" ? d.delta : 0;
                const dr = d && d.mode !== "trim-left" ? d.delta : 0;
                const left = LABEL_W + (c.absStart + dl) * pps;
                const w = Math.max(6, (c.absEnd + dr - (c.absStart + dl)) * pps);
                const over = view ? c.absEnd > view.duration + 1e-6 : false;
                return (
                  <div
                    key={c.ref}
                    className={`tl-clip k-${c.trackKind} ${c.nested ? "nested" : ""} ${c.ref === selected ? "sel" : ""} ${d?.moved ? "dragging" : ""} ${over ? "over" : ""}`}
                    style={{ left, width: w }}
                    onPointerDown={(e) => beginDrag(e, c, "move")}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
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
          {view && lanes.length === 0 && <div className="empty tl-empty">No timed clips yet. Ask the director to build the video, then edit it here.</div>}
          <div className="tl-playhead" style={{ left: LABEL_W + player.time * pps }} />
        </div>
      </div>

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
