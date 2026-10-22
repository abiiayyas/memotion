import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SystemCheck } from "../types";

/**
 * What previewing and rendering need on this computer. Memotion never installs ffmpeg for you; it can download the
 * browser it renders with, and only when you press the button.
 */
export function SystemStatus({ compact = false }: { compact?: boolean }) {
  const [checks, setChecks] = useState<SystemCheck[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChecks((await api.system()).checks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setBusy(true);
    setAsking(false);
    setError(null);
    try {
      setChecks((await api.downloadChrome()).checks);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = checks?.filter((c) => !c.ok) ?? [];
  // In a dialog, say nothing when everything is fine.
  if (compact && checks !== null && missing.length === 0) return null;

  return (
    <section className={compact ? "system-status compact" : "agent-picker system-status"} aria-label="Rendering requirements">
      {!compact && <h3>Rendering requirements</h3>}
      {checks === null && !error && <div className="muted">Checking this computer…</div>}
      {checks?.map((c) => (
        <div key={c.name} className={`sys-row ${c.ok ? "ok" : "bad"}`}>
          <span className="sys-mark" aria-hidden="true">{c.ok ? "✓" : "✕"}</span>
          <span>
            <strong>{c.name}</strong> <small className="muted">{c.ok ? c.detail : "not found"}</small>
            {!c.ok && c.fix && <em className="sys-fix">{c.fix}</em>}
          </span>
        </div>
      ))}
      {checks?.some((c) => c.name === "Chrome" && !c.ok) && (
        asking ? (
          <div className="notice warn" style={{ margin: 0 }}>
            This downloads Chrome (about 150 MB) into Memotion's cache folder, from Google's official download servers. Nothing else on your computer changes.
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => void download()} disabled={busy}>Download</button>
              <button onClick={() => setAsking(false)}>Not now</button>
            </div>
          </div>
        ) : (
          <div className="row"><button onClick={() => setAsking(true)} disabled={busy}>{busy ? "Downloading…" : "Download Chrome…"}</button></div>
        )
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
