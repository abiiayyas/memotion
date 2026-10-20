import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, rawUrl, renderProgress } from "../api";
import type { Project, Quality, RenderJob } from "../types";

const inTauri = "__TAURI_INTERNALS__" in window;

export function ExportPanel({ project }: { project: Project }) {
  const [quality, setQuality] = useState<Quality>("standard");
  const [fps, setFps] = useState<30 | 60>(project.fps);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setFps(project.fps);
    setJob(null);
    setVideoUrl(null);
    setError(null);
  }, [project.id, project.fps]);

  async function start() {
    setError(null);
    setVideoUrl(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const started = await api.startRender(project.id, { quality, fps });
      setJob(started);
      for await (const j of renderProgress(started.id, ctl.signal)) {
        setJob(j);
        if (j.status === "done" && j.output) setVideoUrl(await rawUrl(project.id, j.output));
        if (j.status === "failed") setError(j.error ?? "Render failed");
      }
    } catch (err) {
      if (!ctl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel() {
    if (job) await api.cancelRender(job.id);
  }

  const running = job?.status === "running";

  return (
    <div className="export">
      <div className="row">
        <label>
          Quality
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} disabled={running}>
            <option value="draft">Draft (fast)</option>
            <option value="standard">Standard</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Frame rate
          <select value={fps} onChange={(e) => setFps(Number(e.target.value) === 60 ? 60 : 30)} disabled={running}>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
        {running ? (
          <button className="danger" onClick={() => void cancel()}>
            Cancel
          </button>
        ) : (
          <button className="primary" onClick={() => void start()}>
            Export MP4
          </button>
        )}
      </div>
      {job && job.status !== "cancelled" && (
        <div className="progress">
          <div className="bar">
            <div style={{ width: `${job.pct}%` }} />
          </div>
          <span>
            {job.status === "done" ? "Done" : job.status === "failed" ? "Failed" : `${job.stage.replace(/_/g, " ")} · ${Math.round(job.pct)}%`}
          </span>
        </div>
      )}
      {job?.status === "cancelled" && <div className="notice">Cancelled.</div>}
      {error && <pre className="notice error">{error}</pre>}
      {videoUrl && job?.outputPath && (
        <div className="result">
          <video src={videoUrl} controls style={{ maxHeight: 280, maxWidth: "100%" }} />
          <div className="row">
            <code title={job.outputPath}>{job.output}</code>
            {inTauri && <button onClick={() => void revealItemInDir(job.outputPath ?? "")}>Show in Finder</button>}
          </div>
        </div>
      )}
    </div>
  );
}
