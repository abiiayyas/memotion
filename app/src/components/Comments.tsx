import { api } from "../api";
import type { MarkState } from "../marks";
import type { Project } from "../types";

/** Comments pinned on the preview. Open ones go with the next message to the director; sent ones stay for reference. */
export function CommentsPanel({ project, marks, onAsk, onSeek }: { project: Project; marks: MarkState; onAsk: (text: string) => void; onSeek: (t: number) => void }) {
  const open = marks.comments.filter((c) => c.status === "open");
  const sent = marks.comments.length - open.length;

  async function remove(id: string) {
    await api.deleteComment(project.id, id);
    await marks.reloadComments();
  }

  async function clearSent() {
    await Promise.all(marks.comments.filter((c) => c.status === "sent").map((c) => api.deleteComment(project.id, c.id)));
    await marks.reloadComments();
  }

  return (
    <div className="comments-panel">
      <div className="row">
        <button className="primary" disabled={open.length === 0} onClick={() => { marks.setIncludeComments(true); onAsk("Apply my comments."); }}>
          Send {open.length || ""} open comment{open.length === 1 ? "" : "s"} to the director
        </button>
        <label className="check">
          <input type="checkbox" checked={marks.includeComments} onChange={(e) => marks.setIncludeComments(e.target.checked)} />
          Include open comments with my next message
        </label>
        {sent > 0 && <button className="link" onClick={() => void clearSent()}>Clear {sent} sent</button>}
      </div>
      {marks.comments.length === 0 && <div className="empty">No comments yet. Pick the comment tool under the preview and click a spot.</div>}
      {marks.comments.map((c, i) => (
        <div key={c.id} className={`comment-row ${c.status}`}>
          <span className="n">{i + 1}</span>
          <div style={{ flex: 1 }}>
            <p>{c.text}</p>
            <small>
              <button className="link" onClick={() => onSeek(c.time)}>{c.time.toFixed(1)} s</button> · {c.target?.selector ?? "free spot"}
              {c.status === "sent" ? " · sent" : ""}
            </small>
          </div>
          <button className="link" onClick={() => void remove(c.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
