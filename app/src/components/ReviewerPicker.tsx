import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettings } from "../types";

/** A second model that can SEE, used by directors that cannot. It looks at rendered frames and reports what is wrong. */
export function ReviewerPicker({ refreshKey }: { refreshKey: string }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  // The list of providers that can see changes while the user edits providers below.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function choose(id: string) {
    setError(null);
    try {
      setSettings(await api.setReviewer(id === "" ? null : id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const choices = settings?.reviewerChoices ?? [];
  return (
    <section className="agent-picker" aria-label="Reviewer">
      <h3>Reviewer (a second model that looks at the frames)</h3>
      <label className="reviewer-select">
        <select value={settings?.reviewerProviderId ?? ""} onChange={(e) => void choose(e.target.value)} disabled={!settings} aria-label="Reviewer">
          <option value="">No reviewer</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>{c.name} · {c.model}{c.hasKey ? "" : " (no key)"}</option>
          ))}
        </select>
      </label>
      {settings && settings.reviewerProviderId !== null && !settings.reviewerWorking && (
        <div className="notice warn" style={{ margin: 0 }}>The chosen reviewer no longer works (it was removed, has no key, or is no longer marked as able to see images). No review will happen.</div>
      )}
      {error && <div className="notice error">{error}</div>}
      <p className="hint">
        <code>check</code> cannot see: it once passed a video whose second and third scenes never appeared. With a reviewer, a director that cannot view images (most cheap models) sends frames to it after <code>check</code> and gets back a list of visible problems.
        A director that can see already looks at its own snapshots and does not use it. Each review sends up to six frames to that provider, at most three times per request, and costs what a vision model costs.
        Choose a provider that has <em>Can see images</em> turned on below.
      </p>
    </section>
  );
}
