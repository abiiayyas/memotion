import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AgentBackend, AgentsInfo, CliInfo } from "../types";

function status(cli: CliInfo): { text: string; usable: boolean } {
  if (!cli.found) return { text: `Not found on this computer. Install: ${cli.install}`, usable: false };
  if (cli.signedIn === false) return { text: `Found, but not signed in. Run: ${cli.signInCommand}`, usable: true };
  return { text: cli.signedIn === true ? "Found and signed in" : "Found (sign-in not checked)", usable: true };
}

/** Choose who writes the video: an AI provider (API key) or a coding agent already installed on this computer. */
export function AgentPicker({ onChanged }: { onChanged: () => void }) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A tool the user picked that needs a safeguard turned off: waiting for a yes. */
  const [confirming, setConfirming] = useState<CliInfo | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      setInfo(await api.agents());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  async function choose(backend: AgentBackend, acceptRisk = false) {
    setError(null);
    setConfirming(null);
    try {
      await api.setAgentBackend(backend, acceptRisk);
      setInfo((cur) => (cur ? { ...cur, backend } : cur));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="agent-picker" aria-label="Who writes the video">
      <div className="modal-head" style={{ padding: 0, border: 0 }}>
        <h3>Who writes the video</h3>
        <button onClick={() => void scan()} disabled={scanning}>{scanning ? "Scanning…" : "Rescan"}</button>
      </div>
      <label className={`agent-opt ${info?.backend === "api" ? "sel" : ""}`}>
        <input type="radio" name="agent" checked={info?.backend === "api"} onChange={() => void choose("api")} disabled={!info} />
        <span>
          <strong>AI provider (API key)</strong>
          <em>The provider chosen below. Works with any OpenAI-compatible endpoint.</em>
        </span>
      </label>
      {info?.clis.map((cli) => {
        const s = status(cli);
        const pickable = s.usable;
        return (
          <label key={cli.id} className={`agent-opt ${info.backend === cli.id ? "sel" : ""} ${pickable ? "" : "off"}`}>
            <input
              type="radio"
              name="agent"
              checked={info.backend === cli.id}
              onChange={() => (cli.risk && info.backend !== cli.id ? setConfirming(cli) : void choose(cli.id as AgentBackend))}
              disabled={!pickable}
            />
            <span>
              <strong>{cli.label}</strong> <small>{cli.vendor}{cli.version ? ` · ${cli.version}` : ""}</small>
              <em className={cli.signedIn === false ? "warn-text" : ""}>{s.text}</em>
              {cli.risk && <em className="warn-text">{cli.risk}</em>}
            </span>
          </label>
        );
      })}
      {confirming && (
        <div className="notice warn" role="alertdialog" aria-label={`Use ${confirming.label}?`} style={{ margin: 0 }}>
          <strong>Use {confirming.label}?</strong> {confirming.risk}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="danger" onClick={() => void choose(confirming.id as AgentBackend, true)}>Yes, turn the prompts off for {confirming.label}</button>
            <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      )}
      {!info && !error && <div className="notice">Looking for coding agents on this computer…</div>}
      {error && <div className="notice error">{error}</div>}
      <p className="hint">
        A coding agent works inside the project folder with its own file tools and Memotion's tools (check, snapshots, voice, capture, images). It uses your own
        subscription or quota for that tool. Your personal hooks, plugins and MCP servers are not loaded, and it gets no shell access except Codex's sandbox (project folder only, no network). Antigravity is the exception to the shell rule: see its note above.
      </p>
    </section>
  );
}
