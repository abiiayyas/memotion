import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { usePicker, type MarkState } from "../marks";
import type { Player } from "../player";
import { DrawBar, MarkLayer, MarkToolbar, useDraw } from "./PreviewTools";
import type { Project } from "../types";
import { usePrefs } from "../prefs";

const DIMS = {
  landscape: { w: 1920, h: 1080 },
  portrait: { w: 1080, h: 1920 },
} as const;

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Preview({ project, reloadKey, player, marks }: { project: Project; reloadKey: number; player: Player; marks: MarkState }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const dims = DIMS[project.orientation];
  const picker = usePicker(player.frameRef, `${url}#${reloadKey}`);
  const draw = useDraw(project, player, picker, dims, marks);
  const { skip } = usePrefs();
  // Space plays/pauses from anywhere in the editor, except while typing or in a dialog. The ref keeps one listener for the life of the component.
  const playerRef = useRef(player);
  playerRef.current = player;
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "range" && t.type !== "checkbox"));
    const mine = (e: KeyboardEvent) => (e.code === "Space" || e.key === " ") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !typing(e.target) && !document.querySelector(".modal");
    const onDown = (e: KeyboardEvent) => {
      if (!mine(e)) return;
      e.preventDefault(); // no page scroll, no button "click" from a focused button
      if (!e.repeat) playerRef.current.toggle();
    };
    // A focused button would otherwise click on Space keyup.
    const onUp = (e: KeyboardEvent) => {
      if (mine(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  useEffect(() => {
    setUrl(null);
    setError(null);
    api.preview(project.id).then((p) => setUrl(p.url), (e: Error) => setError(e.message));
  }, [project.id]);

  // Fit the fixed-size composition stage into the available box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // .stage has 16px padding on every side; clientWidth/Height include it.
    const fit = () => setScale(Math.max(0.05, Math.min((el.clientWidth - 32) / dims.w, (el.clientHeight - 32) / dims.h)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.w, dims.h]);

  return (
    <div className="preview">
      <div className="stage" ref={box}>
        {error ? (
          <div className="notice error">Preview failed: {error}</div>
        ) : url ? (
          <div className="frame-wrap" style={{ width: dims.w * scale, height: dims.h * scale }}>
            <iframe
              key={`${url}#${reloadKey}`}
              ref={player.frameRef}
              src={url}
              title="Preview"
              style={{ width: dims.w, height: dims.h, transform: `scale(${scale})` }}
              onLoad={player.pause}
            />
            <MarkLayer project={project} player={player} scale={scale} dims={dims} picker={picker} marks={marks} draw={draw} />
          </div>
        ) : (
          <div className="notice">Starting preview…</div>
        )}
      </div>
      {marks.tool === "draw" && <DrawBar draw={draw} />}
      <div className="transport">
        <button className="skip" onClick={() => player.seek(Math.max(0, player.time - skip))} disabled={!url} aria-label={`Back ${skip} seconds`} title={`Back ${skip} s`}>
          −{skip}s
        </button>
        <button onClick={player.toggle} disabled={!url} aria-label={player.playing ? "Pause" : "Play"}>
          {player.playing ? "❚❚" : "▶"}
        </button>
        <button className="skip" onClick={() => player.seek(Math.min(player.duration, player.time + skip))} disabled={!url} aria-label={`Forward ${skip} seconds`} title={`Forward ${skip} s`}>
          +{skip}s
        </button>
        <MarkToolbar marks={marks} disabled={!url || !picker.ready} />
        <input
          type="range"
          min={0}
          max={Math.max(player.duration, 0.01)}
          step={1 / project.fps}
          value={Math.min(player.time, player.duration || 0)}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={!url || player.duration === 0}
        />
        <span className="time">
          {fmtTime(player.time)} / {fmtTime(player.duration)}
        </span>
        <span className="badge">
          {dims.w}×{dims.h} · {project.fps} fps
        </span>
      </div>
    </div>
  );
}
