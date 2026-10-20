import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import type { CaptionRequest, CaptionStyle, Media, Project, TtsRequest, VoiceOption } from "../types";

type Vendor = "edge" | "openai" | "elevenlabs";

const VENDOR_LABEL: Record<Vendor, string> = {
  edge: "Edge TTS (free, no key)",
  openai: "OpenAI TTS",
  elevenlabs: "ElevenLabs",
};

const STYLE_LABEL: Record<CaptionStyle, string> = {
  highlight: "Highlight — the spoken word lights up",
  pop: "Pop — each word pops in as it is spoken",
  classic: "Classic — phrase slides up",
  clean: "Clean — soft pill, sentence case",
};

export function VoicePanel({ project, onEdited }: { project: Project; onEdited: () => void }) {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [keys, setKeys] = useState<{ openai: boolean; elevenlabs: boolean }>({ openai: false, elevenlabs: false });
  const [mediaList, setMediaList] = useState<Media[]>([]);

  const [text, setText] = useState("");
  const [vendor, setVendor] = useState<Vendor>("edge");
  const [voice, setVoice] = useState("id-ID-GadisNeural");
  const [rate, setRate] = useState(1.0);
  const [withCaptions, setWithCaptions] = useState(true);

  const [style, setStyle] = useState<CaptionStyle>("highlight");
  const [position, setPosition] = useState<"bottom" | "center" | "top">("bottom");
  const [fontSize, setFontSize] = useState(project.orientation === "portrait" ? 64 : 54);
  const [accentColor, setAccentColor] = useState("#ff9d6b");
  const [primaryColor, setPrimaryColor] = useState("#ffffff");
  const [wordsPerGroup, setWordsPerGroup] = useState(3);

  const [selectedMedia, setSelectedMedia] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  /** Set when local transcription needs whisper-cpp: the user must agree before anything is installed. */
  const [needsConsent, setNeedsConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshVoices = useCallback(async () => {
    try {
      setVoices((await api.voices()).voices);
    } catch {
      setVoices([]);
    }
  }, []);
  const refreshKeys = useCallback(async () => {
    try {
      setKeys(await api.ttsKeys());
    } catch {
      // leave the previous state
    }
  }, []);
  const refreshMedia = useCallback(async () => {
    try {
      setMediaList((await api.media(project.id)).filter((m) => m.kind === "audio" || m.kind === "video"));
    } catch {
      setMediaList([]);
    }
  }, [project.id]);

  useEffect(() => {
    void refreshVoices();
    void refreshKeys();
    void refreshMedia();
  }, [refreshVoices, refreshKeys, refreshMedia]);

  const vendorVoices = voices.filter((v) => v.provider === vendor);
  const vendorNeedsKey = vendor !== "edge" && !keys[vendor];

  function chooseVendor(next: Vendor) {
    setVendor(next);
    setKeyDraft("");
    const first = voices.find((v) => v.provider === next);
    if (first) setVoice(first.id);
  }

  const captionRequest = (): CaptionRequest => ({ style, position, fontSize, fontFamily: "Inter", primaryColor, accentColor, wordsPerGroup });

  async function saveKey() {
    if (vendor === "edge" || keyDraft.trim().length < 8) return;
    setError(null);
    try {
      await api.saveTtsKey(vendor, keyDraft.trim());
      setKeyDraft("");
      await refreshKeys();
      await refreshVoices(); // ElevenLabs voices appear once the key exists
      setNotice(`${VENDOR_LABEL[vendor]} key saved in the system keychain.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeKey() {
    await api.removeElevenLabsKey();
    await refreshKeys();
    await refreshVoices();
    chooseVendor("edge");
  }

  async function generate() {
    if (!text.trim() || busy || vendorNeedsKey) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    setNotice("Generating speech and word timings…");
    try {
      const tts: TtsRequest = { text: text.trim(), provider: vendor, voice, rate };
      const res = await api.generateSpeech(project.id, tts, withCaptions ? captionRequest() : undefined);
      setNotice(`Voiceover ready (${res.duration.toFixed(1)}s, ${res.words.length} words).${res.captionsFile ? " Captions are on the timeline." : ""}`);
      if (res.timingEstimated) {
        setWarning("OpenAI returned no word timings, so they were estimated from the script. Captions will drift from the voice; try Edge TTS or ElevenLabs for exact timing.");
      }
      onEdited();
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function transcribe(allowInstall: boolean) {
    if (!selectedMedia || busy) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    setNeedsConsent(false);
    setNotice(allowInstall ? "Installing whisper-cpp and transcribing — the first run downloads a speech model and can take several minutes…" : "Transcribing…");
    try {
      const res = await api.transcribeMedia(project.id, selectedMedia, captionRequest(), { allowInstall });
      setNotice(`Transcribed ${res.words.length} words. Captions are on the timeline.`);
      onEdited();
    } catch (e) {
      setNotice(null);
      if (e instanceof ApiError && e.code === "local_unavailable") setNeedsConsent(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="voice-panel">
      {notice && <div className="notice okmsg">{notice}</div>}
      {warning && <div className="notice warn" style={{ margin: 0 }}>{warning}</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="voice-grid">
        <div className="voice-section">
          <h3>Voiceover</h3>
          <label>
            Script
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Selamat datang di kursus video motion editing…" disabled={busy} />
          </label>

          <div className="row">
            <label>
              Engine
              <select value={vendor} onChange={(e) => chooseVendor(e.target.value as Vendor)} disabled={busy}>
                {(Object.keys(VENDOR_LABEL) as Vendor[]).map((v) => (
                  <option key={v} value={v}>
                    {VENDOR_LABEL[v]}
                    {v !== "edge" && !keys[v] ? " — needs key" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voice
              <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={busy || vendorVoices.length === 0}>
                {vendorVoices.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          </div>

          {vendorNeedsKey && (
            <div className="row">
              <label>
                {VENDOR_LABEL[vendor]} API key (stored in the system keychain)
                <input type="password" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="paste key" autoComplete="off" />
              </label>
              <button onClick={() => void saveKey()} disabled={keyDraft.trim().length < 8}>Save key</button>
            </div>
          )}
          {vendor === "elevenlabs" && keys.elevenlabs && (
            <button className="link" onClick={() => void removeKey()}>Remove the saved ElevenLabs key</button>
          )}

          <div className="row">
            <label>
              Speed {rate.toFixed(1)}×
              <input type="range" min={0.7} max={1.5} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={busy} />
            </label>
            <label className="check" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={withCaptions} onChange={(e) => setWithCaptions(e.target.checked)} disabled={busy} />
              Add captions
            </label>
          </div>

          <button className="primary" onClick={() => void generate()} disabled={!text.trim() || busy || vendorNeedsKey}>
            {busy ? "Working…" : "Generate voice & captions"}
          </button>
        </div>

        <div className="voice-section">
          <h3>Caption style</h3>
          <div className="row">
            <label>
              Style
              <select value={style} onChange={(e) => setStyle(e.target.value as CaptionStyle)} disabled={busy}>
                {(Object.keys(STYLE_LABEL) as CaptionStyle[]).map((s) => (
                  <option key={s} value={s}>{STYLE_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label>
              Position
              <select value={position} onChange={(e) => setPosition(e.target.value as "bottom" | "center" | "top")} disabled={busy}>
                <option value="bottom">Bottom</option>
                <option value="center">Center</option>
                <option value="top">Top</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Accent
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} disabled={busy} style={{ width: 44, height: 30, padding: 0 }} />
            </label>
            <label>
              Text
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} disabled={busy} style={{ width: 44, height: 30, padding: 0 }} />
            </label>
            <label>
              Size {fontSize}px
              <input type="range" min={28} max={120} step={2} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} disabled={busy} />
            </label>
            <label>
              Words/line {wordsPerGroup}
              <input type="range" min={1} max={6} value={wordsPerGroup} onChange={(e) => setWordsPerGroup(Number(e.target.value))} disabled={busy} />
            </label>
          </div>

          <hr style={{ borderColor: "var(--line)", margin: "12px 0 8px", width: "100%" }} />

          <h3>Captions from your own audio or video</h3>
          <div className="row">
            <select value={selectedMedia} onChange={(e) => setSelectedMedia(e.target.value)} disabled={busy || mediaList.length === 0}>
              <option value="">{mediaList.length === 0 ? "Import audio or video in the Media tab first" : "Choose a file…"}</option>
              {mediaList.map((m) => (
                <option key={m.path} value={m.path}>{m.path}</option>
              ))}
            </select>
            <button onClick={() => void transcribe(false)} disabled={!selectedMedia || busy}>Transcribe</button>
          </div>
          {needsConsent && (
            <div className="notice warn" style={{ margin: 0 }}>
              Local transcription needs <code>whisper-cpp</code>. Allowing this runs <code>brew install whisper-cpp</code> and downloads a speech model (hundreds of MB).
              Or skip the install: pick the OpenAI engine above and save your OpenAI key there; transcription then uses cloud Whisper.
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void transcribe(true)} disabled={busy}>Install and transcribe</button>
                <button onClick={() => setNeedsConsent(false)}>Not now</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
