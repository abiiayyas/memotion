import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, rawUrl } from "../api";
import type { Media as MediaItem, Project } from "../types";

const FILTERS = [
  { name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "mov", "webm", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "flac", "ttf", "otf", "woff", "woff2"] },
];

const inTauri = "__TAURI_INTERNALS__" in window;

function Thumb({ projectId, item }: { projectId: string; item: MediaItem }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (item.kind === "image") void rawUrl(projectId, item.path).then(setSrc);
  }, [projectId, item]);
  if (item.kind === "image") return src ? <img src={src} alt="" /> : <div className="ph" />;
  return <div className="ph kind">{item.kind === "video" ? "🎞" : item.kind === "audio" ? "♪" : "Aa"}</div>;
}

export function MediaPanel({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(() => api.media(project.id).then(setItems, () => setItems([])), [project.id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const res = await api.importMedia(project.id, paths);
      setMessage(
        res.failed.length
          ? `Imported ${res.imported.length}. Skipped: ${res.failed.map((f) => `${f.path.split("/").pop()} (${f.error})`).join("; ")}`
          : `Imported ${res.imported.length} file${res.imported.length === 1 ? "" : "s"}. Ask the director to use them.`,
      );
      await refresh();
      onChanged();
    },
    [project.id, refresh, onChanged],
  );

  // Files dropped on the window arrive as absolute paths via Tauri (browsers never expose paths).
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          void importPaths(e.payload.paths);
        }
      })
      .then((u) => (off = u));
    return () => off?.();
  }, [importPaths]);

  async function pick() {
    const chosen = await open({ multiple: true, filters: FILTERS });
    if (!chosen) return;
    await importPaths(Array.isArray(chosen) ? chosen : [chosen]);
  }

  return (
    <div className={`media ${dragging ? "dragging" : ""}`}>
      <div className="media-head">
        <strong>Media</strong>
        {inTauri ? (
          <button onClick={() => void pick()}>Import…</button>
        ) : (
          <span className="muted">Import works in the desktop app</span>
        )}
      </div>
      {message && <div className="notice">{message}</div>}
      {items.length === 0 ? (
        <div className="empty">Drop images, video, music or fonts here, or use Import.</div>
      ) : (
        <ul className="grid">
          {items.map((m) => (
            <li key={m.path} title={m.path}>
              <Thumb projectId={project.id} item={m} />
              <span>{m.path.split("/").pop()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
