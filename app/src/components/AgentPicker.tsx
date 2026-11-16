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

  async function choose(backend: AgentBackend) {
    setError(null);
    try {
      await api.setAgentBackend(backend);
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
              onChange={() => void choose(cli.id as AgentBackend)}
              disabled={!pickable}
            />
            <span>
              <strong>{cli.label}</strong> <small>{cli.vendor}{cli.version ? ` · ${cli.version}` : ""}</small>
              <em className={cli.signedIn === false ? "warn-text" : ""}>{s.text}</em>
            </span>
          </label>
        );
      })}
      {!info && !error && <div className="notice">Looking for coding agents on this computer…</div>}
      {error && <div className="notice error">{error}</div>}
      <p className="hint">
        A coding agent works inside the project folder with its own file tools and Memotion's tools (check, snapshots, voice, capture, images). It uses your own
        subscription or quota for that tool. Your personal hooks, plugins and MCP servers are not loaded, and it gets no shell access except Codex's sandbox (project folder only, no network).
      </p>
    </section>
  );
}
