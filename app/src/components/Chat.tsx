import { useEffect, useRef, useState } from "react";
import { api, chat } from "../api";
import type { ChatItem, Project } from "../types";

type Item = ChatItem | { kind: "error"; text: string };

const TOOL_LABEL: Record<string, string> = {
  list_files: "Listing files",
  list_media: "Listing media",
  read_file: "Reading file",
  write_file: "Writing file",
  edit_file: "Editing file",
  check: "Checking composition",
  snapshot: "Capturing frames",
  read_docs: "Reading docs",
};

export function Chat({
  project,
  onFilesChanged,
  hasProvider,
  openSettings,
  autoSend,
  onAutoSent,
}: {
  project: Project;
  onFilesChanged: () => void;
  hasProvider: boolean;
  openSettings: () => void;
  /** A message another panel wants sent (e.g. the Remotion conversion brief). Sent once, then cleared. */
  autoSend: string | null;
  onAutoSent: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems([]);
    // A message sent before the history arrives (an automatic one) must not be wiped by the late response.
    api.history(project.id).then((h) => setItems((prev) => (prev.length > 0 ? prev : h)), () => undefined);
  }, [project.id]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items]);

  const autoSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoSend) {
      autoSentRef.current = null; // the queue is empty again: the same message may be queued once more later
      return;
    }
    // The ref also guards React StrictMode's second effect run in development.
    if (!hasProvider || busy || autoSentRef.current === autoSend) return;
    autoSentRef.current = autoSend;
    onAutoSent();
    void send(autoSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, hasProvider, busy]);

  async function send(override?: string) {
    const message = (override ?? text).trim();
    if (!message || busy) return;
    if (override === undefined) setText("");
    setBusy(true);
    setItems((prev) => [...prev, { kind: "user", text: message }]);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      for await (const ev of chat(project.id, message, ctl.signal)) {
        setItems((prev) => {
          const next = [...prev];
          const last = next.at(-1);
          switch (ev.type) {
            case "text":
              if (last?.kind === "assistant") next[next.length - 1] = { kind: "assistant", text: last.text + ev.text };
              else next.push({ kind: "assistant", text: ev.text });
              break;
            case "tool-start":
              next.push({ kind: "tool", id: ev.id, name: ev.name });
              break;
            case "tool-result": {
              const i = next.findIndex((x) => x.kind === "tool" && x.id === ev.id);
              const tool = next[i];
              if (tool?.kind === "tool") next[i] = { ...tool, ok: ev.ok, summary: ev.summary };
              break;
            }
            case "error":
              next.push({ kind: "error", text: ev.message });
              break;
            default:
              break;
          }
          return next;
        });
        if (ev.type === "files-changed") onFilesChanged();
      }
    } catch (err) {
      if (!ctl.signal.aborted) {
        setItems((prev) => [...prev, { kind: "error", text: err instanceof Error ? err.message : String(err) }]);
      }
    } finally {
      setBusy(false);
      abort.current = null;
      onFilesChanged();
    }
  }

  function stop() {
    abort.current?.abort();
    void api.cancelChat(project.id);
  }

  async function clear() {
    await api.clearHistory(project.id);
    setItems([]);
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <strong>Director</strong>
        <button className="link" onClick={clear} disabled={busy || items.length === 0}>
          New conversation
        </button>
      </div>
      <div className="messages">
        {items.length === 0 && (
          <div className="empty">
            Describe the video you want. Example: “A 30-second vertical teaser for my coffee shop, warm colors, big
            type, ending on the address.”
          </div>
        )}
        {items.map((it, i) =>
          it.kind === "tool" ? (
            <div key={i} className={`tool ${it.ok === false ? "bad" : it.ok ? "ok" : "run"}`}>
              <span className="dot" />
              {TOOL_LABEL[it.name] ?? it.name}
              {it.summary ? <em> · {it.summary}</em> : null}
            </div>
          ) : (
            <div key={i} className={`msg ${it.kind}`}>
              {it.text}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {!hasProvider && (
        <div className="notice warn">
          No AI provider yet. <button className="link" onClick={openSettings}>Add one in Settings</button>.
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Describe or change the video…"
          rows={3}
          disabled={!hasProvider}
        />
        {busy ? (
          <button type="button" className="danger" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!text.trim() || !hasProvider}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
