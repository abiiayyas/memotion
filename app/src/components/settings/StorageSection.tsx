import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { fmtBytes } from "../../bytes";
import type { StorageInfo } from "../../types";
import { Row } from "./Rows";

/** What leaves this computer, by feature. Nothing here is a switch: each is a consequence of a choice made elsewhere. */
const LEAVES: [string, string][] = [
  ["AI provider and reviewer", "Your messages, the project files the director reads, and (for a provider that can see) snapshots go to the endpoint you set up, with your key. Nowhere else."],
  ["Coding agent", "What you ask goes to that tool's own service, under your own account with it."],
  ["Edge voices", "The text to speak goes to Microsoft's online speech service. No key, no account."],
  ["OpenAI / Gemini / ElevenLabs voices", "The text to speak goes to the vendor you chose, with your key."],
  ["Transcribing", "With an OpenAI key saved, the audio goes to OpenAI. Without one it is transcribed on this computer."],
  ["Website capture", "Memotion opens the address you give it, like a browser would."],
  ["Downloads you ask for", "GSAP from jsDelivr; the render browser from Google's Chrome for Testing; offline voices from GitHub; the speech engine from the npm registry; whisper.cpp and its models from GitHub and Hugging Face. Each one waits for your say-so."],
  ["Memotion itself", "No analytics, no crash reports, no usage tracking. Every HyperFrames command Memotion runs has its telemetry and update checks switched off."],
];

export function StorageSection() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.storage());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setAsking(null);
    setError(null);
    try {
      setInfo(await api.removeStorage(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="sd-block">
        <h3>Downloaded and stored</h3>
        {info && info.items.length === 0 && <div className="notice">Nothing downloaded yet.</div>}
        {info?.items.map((item) => (
          <Row key={item.id} title={`${item.label} · ${fmtBytes(item.bytes)}`} desc={item.note}>
            {asking === item.id ? (
              <div className="row">
                <button type="button" className="danger" onClick={() => void remove(item.id)}>Remove</button>
                <button type="button" onClick={() => setAsking(null)}>Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setAsking(item.id)}>Remove…</button>
            )}
          </Row>
        ))}
        {!info && !error && <div className="notice">Measuring…</div>}
      </div>
      {info && (
        <div className="sd-block">
          <h3>Your work</h3>
          <Row title={`Projects · ${fmtBytes(info.projectsBytes)}`} desc="Everything in your projects, renders included. Delete a project from All projects." />
          <Row title={`Renders · ${fmtBytes(info.rendersBytes)}`} desc="The finished videos inside those projects. Memotion never deletes these by itself." />
        </div>
      )}
      <div className="sd-block">
        <h3>What leaves this computer</h3>
        <dl className="sd-keys wide">
          {LEAVES.map(([what, how]) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>{how}</dd>
            </div>
          ))}
        </dl>
      </div>
      {error && <div className="notice error">{error}</div>}
    </>
  );
}
