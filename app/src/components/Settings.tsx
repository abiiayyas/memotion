import { useEffect, useState } from "react";
import { api } from "../api";
import type { Preset, Provider, TestResult } from "../types";

interface Draft {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  imageModel?: string;
  headers: Record<string, string>;
  capabilities: Provider["capabilities"];
  apiKey: string;
  isNew: boolean;
  hasKey: boolean;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "provider";
}

export function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<(TestResult & { busy?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await api.providers();
    setProviders(res.providers);
    setActive(res.activeProviderId);
    onChanged();
  }

  useEffect(() => {
    void api.presets().then(setPresets);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startFrom(preset: Preset) {
    const taken = new Set(providers.map((p) => p.id));
    let id = preset.presetId;
    for (let n = 2; taken.has(id); n++) id = `${preset.presetId}-${n}`;
    setModels([]);
    setTest(null);
    setError(null);
    setDraft({
      id,
      name: preset.name,
      baseURL: preset.baseURL,
      model: preset.model,
      headers: preset.headers ?? {},
      capabilities: preset.capabilities,
      apiKey: "",
      isNew: true,
      hasKey: false,
    });
  }

  function edit(p: Provider) {
    setModels([]);
    setTest(null);
    setError(null);
    setDraft({ ...p, apiKey: "", isNew: false });
  }

  async function save(): Promise<boolean> {
    if (!draft) return false;
    setError(null);
    try {
      await api.saveProvider(
        { id: draft.id || slug(draft.name), name: draft.name, baseURL: draft.baseURL, model: draft.model, imageModel: draft.imageModel?.trim() || undefined, headers: draft.headers, capabilities: draft.capabilities },
        draft.apiKey || undefined,
      );
      setDraft({ ...draft, apiKey: "", isNew: false, hasKey: draft.hasKey || draft.apiKey !== "" });
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function runTest() {
    if (!draft || !(await save())) return;
    setTest({ ok: false, message: "Testing…", busy: true });
    try {
      const res = await api.testProvider(draft.id);
      setTest(res);
      if (res.ok && res.toolCalling === false) {
        setDraft((d) => (d ? { ...d, capabilities: { ...d.capabilities, tools: false } } : d));
      }
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function loadModels() {
    if (!draft || !(await save())) return;
    try {
      setModels((await api.models(draft.id)).models);
    } catch (err) {
      setError(`Could not list models: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function remove(id: string) {
    await api.deleteProvider(id);
    if (draft?.id === id) setDraft(null);
    await reload();
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>AI providers</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="settings">
          <div className="providers">
            {providers.map((p) => (
              <div key={p.id} className={`prov ${draft?.id === p.id ? "sel" : ""}`}>
                <button className="prov-main" onClick={() => edit(p)}>
                  <strong>{p.name}</strong>
                  <span>{p.model || "no model"} {p.hasKey ? "" : "· no key"}</span>
                </button>
                <label title="Use for new requests">
                  <input type="radio" name="active" checked={active === p.id} onChange={() => void api.setActiveProvider(p.id).then(reload)} />
                  active
                </label>
              </div>
            ))}
            <div className="add">
              <select value="" onChange={(e) => { const pr = presets.find((x) => x.presetId === e.target.value); if (pr) startFrom(pr); }}>
                <option value="">+ Add provider…</option>
                {presets.map((p) => (
                  <option key={p.presetId} value={p.presetId}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {draft ? (
            <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label>Name<input value={draft.name} onChange={(e) => set("name", e.target.value)} required /></label>
              <label>
                Base URL
                <input value={draft.baseURL} onChange={(e) => set("baseURL", e.target.value)} placeholder="https://api.example.com/v1" required />
              </label>
              <label>
                API key {draft.hasKey && <em>(saved in the system keychain; leave empty to keep)</em>}
                <input type="password" value={draft.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder={draft.hasKey ? "••••••••" : "sk-…"} autoComplete="off" />
              </label>
              <label>
                Model
                <div className="row">
                  <input list="models" value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="model id" required />
                  <button type="button" onClick={() => void loadModels()} disabled={!draft.baseURL}>List models</button>
                </div>
                <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
              </label>
              <fieldset>
                <legend>Capabilities</legend>
                {(["tools", "vision", "images"] as const).map((k) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={draft.capabilities[k]} onChange={(e) => set("capabilities", { ...draft.capabilities, [k]: e.target.checked })} />
                    {k === "tools" ? "Tool calling (required for the director agent)" : k === "vision" ? "Can see images (lets the agent review snapshots)" : "Can generate images (paid, needs an image model below)"}
                  </label>
                ))}
                {draft.capabilities.images && (
                  <label>
                    Image model
                    <input value={draft.imageModel ?? ""} onChange={(e) => set("imageModel", e.target.value)} placeholder="gpt-image-1" />
                  </label>
                )}
              </fieldset>
              {error && <div className="notice error">{error}</div>}
              {test && <div className={`notice ${test.ok ? "okmsg" : "error"}`}>{test.ok ? `Connected. Model replied: “${test.message}”. Tool calling: ${test.toolCalling ? "works" : "not supported"}.` : test.message}</div>}
              <div className="row">
                <button type="submit" className="primary">Save</button>
                <button type="button" onClick={() => void runTest()} disabled={test?.busy}>Save &amp; test</button>
                {!draft.isNew && <button type="button" className="danger" onClick={() => void remove(draft.id)}>Delete</button>}
              </div>
            </form>
          ) : (
            <div className="empty">Pick a provider on the left, or add one. Any OpenAI-compatible endpoint works. Keys never leave your machine except in requests to that provider.</div>
          )}
        </div>
      </div>
    </div>
  );
}
