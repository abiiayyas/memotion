import { useEffect, useRef } from "react";
import type { Project } from "../types";
import { ProjectAvatar } from "./Home";

/**
 * "Are you sure?" for deleting a project. A real dialog, not window.confirm (unreliable in the desktop webview).
 * Focus starts on Cancel so a stray Enter cannot delete anything, and Escape or a click outside cancels.
 */
export function ConfirmDelete({
  project,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  project: Project;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div className="modal small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-text" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="confirm-delete-title">Delete this project?</h2>
        </div>
        <div className="form">
          <div className="confirm-project">
            <ProjectAvatar project={project} size={34} />
            <strong>{project.name}</strong>
          </div>
          <p id="confirm-delete-text" className="muted">
            Are you sure? This permanently deletes the project with its scenes, media, renders, comments and chat. It cannot be undone.
          </p>
          {error && <div className="notice error">{error}</div>}
          <div className="row">
            <button ref={cancel} type="button" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="danger" onClick={onConfirm} disabled={busy}>{busy ? "Deleting…" : "Delete project"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
