import { useRef, useState } from "react";
import { api } from "../api";
import type { Project, RemotionAnalysis } from "../types";
import { PathField } from "./PathField";

type Kind = "hyperframes" | "remotion";

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (project: Project, autoPrompt?: string) => void }) {
  const [kind, setKind] = useState<Kind>("hyperframes");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [analysis, setAnalysis] = useState<RemotionAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositionId, setCompositionId] = useState("");
  const [rendering, setRendering] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const reset = (next: Partial<{ kind: Kind; path: string }>) => {
    if (next.kind) setKind(next.kind);
    if (next.path !== undefined) setPath(next.path);
    setAnalysis(null);
    setError(null);
  };

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const importHyperframes = () =>
    run(async () => {
      const project = await api.importHyperframes(path.trim(), name.trim() || undefined);
      onImported(project);
      onClose();
    });

  const analyze = () => run(async () => setAnalysis(await api.analyzeRemotion(path.trim())));

  const convert = (force: boolean) =>
    run(async () => {
      const res = await api.importRemotion(path.trim(), name.trim() || undefined, force);
      onImported(res.project, res.prompt);
      onClose();
    });

  const renderVideo = () =>
    run(async () => {
      const ctl = new AbortController();
      abort.current = ctl;
      setRendering(true);
      try {
        const res = await api.renderRemotion(path.trim(), name.trim() || undefined, compositionId || undefined, ctl.signal);
        onImported(res.project);
        onClose();
      } finally {
        abort.current = null;
        setRendering(false);
      }
    });

  // Closing the dialog during a render stops it; the server removes the half-made project.
  const close = () => {
    abort.current?.abort();
    onClose();
  };

  const blockers = analysis?.findings.filter((f) => f.severity === "blocker") ?? [];
  const others = analysis?.findings.filter((f) => f.severity !== "blocker") ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" style={{ width: "min(640px, 94vw)" }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Import project">
        <div className="modal-head">
          <h2>Import a project</h2>
          <button onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="form">
          <div className="seg" role="radiogroup" aria-label="Project type">
            <button type="button" role="radio" aria-checked={kind === "hyperframes"} className={kind === "hyperframes" ? "on" : ""} onClick={() => reset({ kind: "hyperframes" })}>
              HyperFrames<small>copied as it is</small>
            </button>
            <button type="button" role="radio" aria-checked={kind === "remotion"} className={kind === "remotion" ? "on" : ""} onClick={() => reset({ kind: "remotion" })}>
              Remotion<small>translated by the director</small>
            </button>
          </div>

          <label>
            Project folder
            <PathField label="Project folder" value={path} onChange={(p) => reset({ path: p })} placeholder="/path/to/project" directory disabled={busy} />
          </label>
          <label>
            Name (optional)
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>

          {kind === "hyperframes" ? (
            <p className="muted">The folder must contain an <code>index.html</code>. Memotion copies it; the original is never changed.</p>
          ) : (
            <p className="muted">
              Memotion reads your Remotion source, copies it to <code>import/remotion/</code>, and asks the director to rebuild it as HTML. Interactive state (<code>useState</code>, effects with dependencies) and UI libraries cannot become a video.
            </p>
          )}

          {error && <div className="notice error">{error}</div>}

          {analysis && (
            <div className="notice" style={{ whiteSpace: "normal" }}>
              {analysis.facts.orientation === "portrait" ? "9:16" : "16:9"} at {analysis.facts.fps} fps, {analysis.sourceFiles} source files.
              {blockers.length > 0 && (
                <>
                  <strong style={{ display: "block", marginTop: 6, color: "var(--err-ink)" }}>These will not translate:</strong>
                  <ul>{blockers.map((f, i) => <li key={i}><code>{f.file}</code>: {f.message}</li>)}</ul>
                </>
              )}
              {others.length > 0 && (
                <>
                  <strong style={{ display: "block", marginTop: 6 }}>Notes:</strong>
                  <ul>{others.map((f, i) => <li key={i}><code>{f.file}</code>: {f.message}</li>)}</ul>
                </>
              )}
              {blockers.length === 0 && others.length === 0 && <div>Nothing in the source needs special handling.</div>}
            </div>
          )}

          {analysis && (
            <div className="notice" style={{ whiteSpace: "normal" }}>
              <strong>Or keep it exactly as it is.</strong> Memotion renders it with the Remotion installed in your project and plays the result as one video clip. Everything Remotion can do works, including state and UI libraries, but the result is footage: you can trim, move and add to it, not edit its elements.
              {analysis.compositions.length > 1 && (
                <label style={{ display: "block", marginTop: 8 }}>
                  Composition
                  <select value={compositionId || analysis.compositions[0]} onChange={(e) => setCompositionId(e.target.value)} disabled={busy}>
                    {analysis.compositions.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                </label>
              )}
              <div style={{ marginTop: 8 }}>
                {analysis.render.ready ? (
                  <button onClick={() => void renderVideo()} disabled={busy}>{rendering ? "Rendering… this can take several minutes" : "Render as video"}</button>
                ) : (
                  <span className="muted">{analysis.render.reason}</span>
                )}
              </div>
            </div>
          )}

          <div className="row">
            {kind === "hyperframes" ? (
              <button className="primary" onClick={() => void importHyperframes()} disabled={busy || !path.trim()}>{busy ? "Importing…" : "Import"}</button>
            ) : !analysis ? (
              <button className="primary" onClick={() => void analyze()} disabled={busy || !path.trim()}>{busy ? "Reading…" : "Check the project"}</button>
            ) : blockers.length > 0 ? (
              <button className="danger" onClick={() => void convert(true)} disabled={busy}>Convert anyway, dropping those parts</button>
            ) : (
              <button className="primary" onClick={() => void convert(false)} disabled={busy}>{busy && !rendering ? "Importing…" : "Import and convert"}</button>
            )}
            <button onClick={close} disabled={busy && !rendering}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
