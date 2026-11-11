import { useCallback, useEffect, useRef, useState } from "react";
import { api, fetchFrame, uploadMarkImage } from "../api";
import type { MarkState, Picker, Tool } from "../marks";
import type { Player } from "../player";
import type { Project, Target } from "../types";

export const DRAW_COLORS = [
  { id: "green", css: "#2fbf71" },
  { id: "red", css: "#ff4d4f" },
  { id: "yellow", css: "#ffd23f" },
  { id: "blue", css: "#3b82f6" },
  { id: "white", css: "#ffffff" },
] as const;

const MAX_STROKES = 200;
/** Width of the pen in composition pixels; about 3 px on screen at the usual preview size. */
const PEN = 10;
const MAX_SIDE = 1280;

interface Stroke {
  color: string;
  points: [number, number][];
}

interface Dims {
  w: number;
  h: number;
}

/**
 * A data: URL as a Blob, without fetch: the app's CSP (connect-src) does not allow data: URLs, so `fetch(dataUrl)`
 * works in the browser but fails in the packaged app.
 */
export function dataUrlToBlob(url: string): Blob {
  const [head, body = ""] = url.split(",");
  const mime = /^data:([^;]+)/.exec(head ?? "")?.[1] ?? "application/octet-stream";
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────

export interface Draw {
  color: string;
  setColor: (c: string) => void;
  strokes: Stroke[];
  begin: (x: number, y: number) => void;
  extend: (x: number, y: number) => void;
  undo: () => void;
  clear: () => void;
  note: string;
  setNote: (n: string) => void;
  busy: boolean;
  error: string | null;
  /** Capture the frame, put the strokes on it, and hold it for the next message. */
  attach: () => void;
}

function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], k: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = PEN * k;
    const [first, ...rest] = s.points;
    if (!first) continue;
    if (rest.length === 0) {
      ctx.beginPath();
      ctx.arc(first[0] * k, first[1] * k, (PEN * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(first[0] * k, first[1] * k);
    for (const [x, y] of rest) ctx.lineTo(x * k, y * k);
    ctx.stroke();
  }
}

/** Up to `max` points spread over all strokes, to ask the page what lies under the drawing. */
export function samplePoints(strokes: Stroke[], max: number): [number, number][] {
  const all = strokes.flatMap((s) => s.points);
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, i) => all[Math.floor(i * step)] ?? [0, 0]);
}

export function useDraw(project: Project, player: Player, picker: Picker, dims: Dims, marks: MarkState): Draw {
  const [color, setColor] = useState<string>(DRAW_COLORS[0].css);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(
    (x: number, y: number) => setStrokes((cur) => (cur.length >= MAX_STROKES ? cur : [...cur, { color, points: [[x, y]] }])),
    [color],
  );
  const extend = useCallback(
    (x: number, y: number) =>
      setStrokes((cur) => {
        const last = cur.at(-1);
        if (!last) return cur;
        return [...cur.slice(0, -1), { ...last, points: [...last.points, [x, y]] }];
      }),
    [],
  );

  const finish = useCallback(
    async (hits: Target[], list: Stroke[], text: string, at: number) => {
      try {
        const frame = await createImageBitmap(await fetchFrame(project.id, at));
        const k = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(frame.width * k);
        canvas.height = Math.round(frame.height * k);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser cannot draw the image.");
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        paint(ctx, list, canvas.width / dims.w);

        const png = dataUrlToBlob(canvas.toDataURL("image/png"));
        const imagePath = await uploadMarkImage(project.id, png);

        const thumb = document.createElement("canvas");
        const tk = 96 / Math.max(canvas.width, canvas.height);
        thumb.width = Math.round(canvas.width * tk);
        thumb.height = Math.round(canvas.height * tk);
        thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);

        marks.setDrawing({ imagePath, note: text, hits, time: at, thumb: thumb.toDataURL("image/png") });
        setStrokes([]);
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [project.id, dims.w, marks],
  );

  const attach = useCallback(() => {
    if (strokes.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const list = strokes;
    const text = note.trim();
    const at = player.time;
    // Ask the page what lies under the pen, then capture the frame.
    picker.describe(samplePoints(list, 60), (hits) => void finish(hits, list, text, at));
  }, [strokes, busy, note, player.time, picker, finish]);

  return {
    color,
    setColor,
    strokes,
    begin,
    extend,
    undo: () => setStrokes((cur) => cur.slice(0, -1)),
    clear: () => setStrokes([]),
    note,
    setNote,
    busy,
    error,
    attach,
  };
}

// ── toolbar ──────────────────────────────────────────────────────────────────────────────

const ICONS: Record<Tool, React.ReactElement> = {
  select: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 9l10 4-4.2 1.8L13 19z" />
      <path d="M5.5 5.5l1.6 1.6M10 3.5V6M3.5 10H6M13.5 5.2l-1.2 1.2" />
    </svg>
  ),
  draw: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.5 4.5l4 4L8 20l-4.5 1L4.5 16.5z" />
      <path d="M13 7l4 4" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4C7.6 4 4 7 4 10.7c0 2 1 3.7 2.7 4.9L6 20l4-2.1c.6.1 1.3.2 2 .2 4.4 0 8-3 8-6.7S16.4 4 12 4z" />
      <path d="M12 8.5V13M9.7 10.7h4.6" />
    </svg>
  ),
};

const TOOL_HELP: Record<Tool, string> = {
  select: "Select an element: hover to see it, click to tell the director “this one”",
  draw: "Draw on the frame to show what to change",
  comment: "Pin a comment on a spot",
};

/** Pen options while the draw tool is on. Sits in the layout between the stage and the transport, never over the frame. */
export function DrawBar({ draw }: { draw: Draw }) {
  return (
    <div className="draw-bar">
      {DRAW_COLORS.map((c) => (
        <button key={c.id} className={`swatch ${draw.color === c.css ? "on" : ""}`} style={{ background: c.css }} onClick={() => draw.setColor(c.css)} aria-label={`Pen ${c.id}`} title={c.id} />
      ))}
      <button onClick={draw.undo} disabled={draw.strokes.length === 0 || draw.busy}>Undo</button>
      <button onClick={draw.clear} disabled={draw.strokes.length === 0 || draw.busy}>Clear</button>
      <input value={draw.note} onChange={(e) => draw.setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} disabled={draw.busy} />
      <button className="primary" onClick={draw.attach} disabled={draw.strokes.length === 0 || draw.busy}>
        {draw.busy ? "Capturing frame…" : "Attach to message"}
      </button>
      {draw.error && <span className="draw-error">{draw.error}</span>}
    </div>
  );
}

/** The three mark tools as small icon buttons, meant to sit in the transport row. */
export function MarkToolbar({ marks, disabled }: { marks: MarkState; disabled: boolean }) {
  return (
    <div className="mark-toolbar" role="toolbar" aria-label="Preview tools">
      {(Object.keys(ICONS) as Tool[]).map((t) => (
        <button
          key={t}
          className={`tool ${marks.tool === t ? "on" : ""}`}
          onClick={() => marks.setTool(t)}
          disabled={disabled}
          aria-pressed={marks.tool === t}
          aria-label={TOOL_HELP[t]}
          title={TOOL_HELP[t]}
        >
          {ICONS[t]}
        </button>
      ))}
    </div>
  );
}

// ── the layer over the preview frame ─────────────────────────────────────────────────────

interface Draft {
  x: number;
  y: number;
  target?: Target;
}

export function MarkLayer({
  project,
  player,
  scale,
  dims,
  picker,
  marks,
  draw,
}: {
  project: Project;
  player: Player;
  scale: number;
  dims: Dims;
  picker: Picker;
  marks: MarkState;
  draw: Draw;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hoverAt = useRef<[number, number] | null>(null);
  const hoverFrame = useRef(0);
  const drawing = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const at = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = layer.current?.getBoundingClientRect();
    return r ? [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale] : [0, 0];
  };

  // The strokes, redrawn whenever they change.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    paint(ctx, draw.strokes, 1);
  }, [draw.strokes]);

  // Leaving a tool drops half-finished work of that tool.
  useEffect(() => {
    setDraft(null);
    setDraftText("");
    picker.leave();
  }, [marks.tool, picker]);

  // Clearing the selection (the chip's ✕) removes the box in the page; a reloaded page gets it back.
  useEffect(() => {
    if (!marks.selection) picker.clear();
    else if (picker.ready) picker.reselect(marks.selection.target.selector);
  }, [marks.selection, picker]);

  const onMove = (e: React.PointerEvent) => {
    const p = at(e);
    if (marks.tool === "select") {
      hoverAt.current = p;
      if (hoverFrame.current === 0) {
        hoverFrame.current = requestAnimationFrame(() => {
          hoverFrame.current = 0;
          const h = hoverAt.current;
          if (h) picker.hover(h[0], h[1]);
        });
      }
    } else if (marks.tool === "draw" && drawing.current) {
      draw.extend(p[0], p[1]);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (marks.tool !== "draw" || draw.busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = at(e);
    draw.begin(x, y);
  };

  const onClick = (e: React.MouseEvent) => {
    const [x, y] = at(e);
    if (marks.tool === "select") {
      picker.select(x, y, (target) => marks.setSelection(target ? { target, time: player.time } : null));
    } else if (marks.tool === "comment") {
      setOpenPin(null);
      setDraft({ x, y });
      setDraftText("");
      // The element under the pin is attached when the page answers; the comment does not wait for it.
      picker.describe([[x, y]], (targets) => setDraft((cur) => (cur && cur.x === x && cur.y === y ? { ...cur, target: targets[0] } : cur)));
    }
  };

  async function saveDraft() {
    if (!draft || draftText.trim().length === 0) return;
    setError(null);
    try {
      await api.addComment(project.id, { time: player.time, x: draft.x, y: draft.y, text: draftText.trim(), target: draft.target });
      setDraft(null);
      setDraftText("");
      await marks.reloadComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removePin(id: string) {
    await api.deleteComment(project.id, id);
    setOpenPin(null);
    await marks.reloadComments();
  }

  const shown = marks.comments.filter((c) => marks.tool === "comment" || Math.abs(c.time - player.time) <= 1.5);
  const cursor = marks.tool === "select" ? "pointer" : marks.tool === "draw" ? "crosshair" : "copy";

  return (
    <div
      ref={layer}
      className={`mark-layer tool-${marks.tool}`}
      style={{ cursor }}
      onPointerMove={onMove}
      onPointerLeave={() => marks.tool === "select" && picker.leave()}
      onPointerDown={onDown}
      onPointerUp={() => {
        drawing.current = false;
      }}
      onPointerCancel={() => {
        drawing.current = false;
      }}
      onClick={onClick}
    >
      <canvas ref={canvas} width={dims.w} height={dims.h} className="draw-canvas" />
      {shown.map((c) => (
        <div key={c.id} className="pin-wrap" style={{ left: c.x * scale, top: c.y * scale }} onClick={(e) => e.stopPropagation()}>
          <button className={`pin ${c.status}`} onClick={() => setOpenPin(openPin === c.id ? null : c.id)} aria-label={`Comment: ${c.text}`}>
            {marks.comments.indexOf(c) + 1}
          </button>
          {openPin === c.id && (
            <div className="pin-card">
              <p>{c.text}</p>
              <small>{c.target?.selector ?? "free spot"} · {c.time.toFixed(1)} s{c.status === "sent" ? " · sent" : ""}</small>
              <button className="link" onClick={() => void removePin(c.id)}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {draft && (
        <div className="pin-wrap" style={{ left: draft.x * scale, top: draft.y * scale }} onClick={(e) => e.stopPropagation()}>
          <span className="pin new">+</span>
          <form
            className="pin-card edit"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <textarea
              autoFocus
              rows={3}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder={draft.target ? `Comment on ${draft.target.selector}` : "What should change here?"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveDraft();
                } else if (e.key === "Escape") setDraft(null);
              }}
            />
            {error && <small className="draw-error">{error}</small>}
            <div className="row">
              <button type="submit" className="primary" disabled={draftText.trim().length === 0}>Add comment</button>
              <button type="button" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
