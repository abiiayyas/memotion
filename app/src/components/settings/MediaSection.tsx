import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { usePrefs } from "../../prefs";
import type { AppSettings, CaptionStyle, LocalTtsStatus, Preferences, VoiceOption } from "../../types";
import { Row, Seg, Slider, Switch } from "./Rows";

type Vendor = Preferences["voiceVendor"];
type KeyVendor = "openai" | "gemini" | "elevenlabs";

const VENDORS: { value: Vendor; label: string }[] = [
  { value: "edge", label: "Edge (free)" },
  { value: "local", label: "Offline" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "elevenlabs", label: "ElevenLabs" },
];

const STYLES: { value: CaptionStyle; label: string }[] = [
  { value: "highlight", label: "Highlight" },
  { value: "pop", label: "Pop" },
  { value: "classic", label: "Classic" },
  { value: "clean", label: "Clean" },
];

const WHISPER: { value: Preferences["whisperModel"]; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "base", label: "Base" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
];

/** Keys for the voice vendors, the default voice and captions, offline voices, speech recognition, and image generation. */
export function MediaSection() {
  const { prefs, update } = usePrefs();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [keys, setKeys] = useState<{ openai: boolean; gemini: boolean; elevenlabs: boolean }>({ openai: false, gemini: false, elevenlabs: false });
  const [local, setLocal] = useState<LocalTtsStatus | null>(null);
  const [app, setApp] = useState<AppSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<KeyVendor, string>>({ openai: "", gemini: "", elevenlabs: "" });
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const load = useCallback(async () => {
    const [v, k, l, a] = await Promise.allSettled([api.voices(), api.ttsKeys(), api.localTts(), api.settings()]);
    if (v.status === "fulfilled") setVoices(v.value.voices);
    if (k.status === "fulfilled") setKeys(k.value);
    if (l.status === "fulfilled") setLocal(l.value);
    if (a.status === "fulfilled") setApp(a.value);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const change = (patch: Partial<Preferences>) => void update(patch).catch(fail);

  async function saveKey(vendor: KeyVendor) {
    setError(null);
    try {
      await api.saveTtsKey(vendor, drafts[vendor].trim());
      setDrafts((d) => ({ ...d, [vendor]: "" }));
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function removeElevenLabs() {
    try {
      await api.removeElevenLabsKey();
      await load();
      if (prefs?.voiceVendor === "elevenlabs") change({ voiceVendor: "edge", voiceId: "id-ID-GadisNeural" });
    } catch (e) {
      fail(e);
    }
  }

  async function install(voiceId: string) {
    setInstalling(voiceId);
    setError(null);
    try {
      setLocal(await api.installLocalTts(voiceId));
    } catch (e) {
      fail(e);
    } finally {
      setInstalling(null);
    }
  }

  function chooseVendor(vendor: Vendor) {
    const first = voices.find((v) => v.provider === vendor);
    change(first ? { voiceVendor: vendor, voiceId: first.id } : { voiceVendor: vendor });
  }

  const vendor = prefs?.voiceVendor ?? "edge";
  const vendorVoices = voices.filter((v) => v.provider === vendor);
  const needsKey = (vendor === "openai" || vendor === "gemini" || vendor === "elevenlabs") && !keys[vendor];

  const keyRow = (v: KeyVendor, title: string, desc: string) => (
    <Row title={title} desc={`${desc} ${keys[v] ? "A key is saved." : "No key yet."}`}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void saveKey(v); }}>
        <input type="password" autoComplete="off" value={drafts[v]} placeholder={keys[v] ? "••••••••" : "Paste a key"} aria-label={`${title}`} onChange={(e) => setDrafts((d) => ({ ...d, [v]: e.target.value }))} />
        <button type="submit" disabled={drafts[v].trim().length < 8}>Save</button>
        {v === "elevenlabs" && keys[v] && <button type="button" className="danger" onClick={() => void removeElevenLabs()}>Remove</button>}
      </form>
    </Row>
  );

  return (
    <>
      <div className="sd-block">
        <h3>Voice keys</h3>
        {keyRow("openai", "OpenAI key", "For OpenAI voices, and for cloud speech recognition. The same key serves an OpenAI chat provider; it lives in the system keychain.")}
        {keyRow("gemini", "Google Gemini key", "For Gemini voices (an AI Studio key, aistudio.google.com/apikey). The same key serves a Google Gemini chat provider; it lives in the system keychain.")}
        {keyRow("elevenlabs", "ElevenLabs key", "For ElevenLabs voices. Kept in the system keychain.")}
      </div>

      <div className="sd-block">
        <h3>Default voice and captions</h3>
        <Row title="Voice service" desc="What the Voice tab starts with.">
          <Seg label="Voice service" value={vendor} options={VENDORS} disabled={!prefs} onChange={chooseVendor} />
        </Row>
        <Row title="Voice" desc={needsKey ? "Needs a key above before it can speak." : vendorVoices.length === 0 ? "No voices listed for this service yet." : undefined}>
          <select aria-label="Default voice" value={prefs?.voiceId ?? ""} disabled={!prefs || vendorVoices.length === 0} onChange={(e) => change({ voiceId: e.target.value })}>
            {!vendorVoices.some((v) => v.id === prefs?.voiceId) && <option value={prefs?.voiceId ?? ""}>{prefs?.voiceId ?? ""}</option>}
            {vendorVoices.map((v) => (
              <option key={v.id} value={v.id}>{v.name} · {v.locale}</option>
            ))}
          </select>
        </Row>
        <Row title="Speaking speed">
          <Slider value={Math.round((prefs?.voiceRate ?? 1) * 100)} min={50} max={200} step={5} unit="%" label="Speaking speed" disabled={!prefs} onCommit={(v) => change({ voiceRate: v / 100 })} />
        </Row>
        <Row title="Captions with the voiceover" desc="Word-by-word captions are added to the video along with the audio.">
          <Switch label="Captions with the voiceover" value={prefs?.captionsOn ?? true} disabled={!prefs} onChange={(v) => change({ captionsOn: v })} />
        </Row>
        <Row title="Caption style">
          <Seg label="Caption style" value={prefs?.captionStyle ?? "highlight"} options={STYLES} disabled={!prefs} onChange={(v) => change({ captionStyle: v })} />
        </Row>
        <Row title="Caption position">
          <Seg label="Caption position" value={prefs?.captionPosition ?? "bottom"} disabled={!prefs} onChange={(v) => change({ captionPosition: v })} options={[{ value: "bottom", label: "Bottom" }, { value: "center", label: "Centre" }, { value: "top", label: "Top" }]} />
        </Row>
      </div>

      <div className="sd-block">
        <h3>Offline voices</h3>
        {local && !local.supported ? (
          <div className="notice">Offline voices are not available on this computer.</div>
        ) : (
          Object.entries(local?.voices ?? {}).map(([id, ready]) => {
            const name = voices.find((v) => v.id === id)?.name ?? id;
            return (
              <Row key={id} title={name} desc={ready && local?.engine ? "Installed." : `Not installed. About ${local?.voiceSizes[id] ?? "?"} MB, plus the speech engine the first time.`}>
                {!(ready && local?.engine) && <button type="button" onClick={() => void install(id)} disabled={installing !== null}>{installing === id ? "Downloading…" : "Install"}</button>}
              </Row>
            );
          })
        )}
      </div>

      <div className="sd-block">
        <h3>Speech to text</h3>
        <Row title="Model for transcribing on this computer" desc="Bigger models hear more accurately and take longer and more space (about 140 MB, 470 MB and 1.5 GB). Automatic uses Small, with its English-only version for English. A model is downloaded the first time it is used, after you allow it. With an OpenAI key saved, transcribing uses OpenAI's service instead.">
          <Seg label="Speech to text model" value={prefs?.whisperModel ?? "auto"} options={WHISPER} disabled={!prefs} onChange={(v) => change({ whisperModel: v })} />
        </Row>
      </div>

      <div className="sd-block">
        <h3>AI images</h3>
        <Row title="Let the director generate images" desc={app?.imageBlocker ?? "Each image costs money with the provider that makes it. The limit per request is under Agents."}>
          <Switch label="Generate images" value={app?.imageGeneration ?? false} disabled={!app} onChange={(on) => void api.setImageGeneration(on).then(setApp, fail)} />
        </Row>
      </div>
      {error && <div className="notice error">{error}</div>}
    </>
  );
}
