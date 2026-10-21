import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { usePicker, type MarkState } from "../marks";
import type { Player } from "../player";
import { MarkLayer, MarkToolbar, useDraw } from "./PreviewTools";
import type { Project } from "../types";

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
        <MarkToolbar marks={marks} draw={draw} disabled={!url || !picker.ready} />
      </div>
      <div className="transport">
        <button onClick={player.toggle} disabled={!url} aria-label={player.playing ? "Pause" : "Play"}>
          {player.playing ? "❚❚" : "▶"}
        </button>
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
