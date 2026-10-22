import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../../api";
import { usePrefs, SKIP_DEFAULT } from "../../prefs";
import { setTheme } from "../../theme";
import { Row, Seg, Slider } from "./Rows";

const inTauri = "__TAURI_INTERNALS__" in window;

export function GeneralSection() {
  const { prefs, skip, setSkip, update, reset } = usePrefs();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.about().then((a) => setDataDir(a.dataDir), () => setDataDir(null));
  }, []);

  const change = (patch: Parameters<typeof update>[0]) => void update(patch).catch((e) => setError(e instanceof Error ? e.message : String(e)));

  async function resetAll() {
    setConfirm(false);
    setSkip(SKIP_DEFAULT);
    setTheme("system");
    try {
      await reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Row title="Skip distance" desc="How far the skip buttons under the preview, and Shift+arrow on the timeline when no clip is selected, move the playhead.">
        <Slider value={skip} min={1} max={30} unit=" s" label="Skip distance" onCommit={setSkip} />
      </Row>
      <Row title="New videos: shape" desc="What the home page starts with. A template or format can still set its own.">
        <Seg label="New video shape" value={prefs?.newVideoOrientation ?? "landscape"} disabled={!prefs} onChange={(v) => change({ newVideoOrientation: v })} options={[{ value: "landscape", label: "16:9" }, { value: "portrait", label: "9:16" }]} />
      </Row>
      <Row title="New videos: frame rate">
        <Seg label="New video frame rate" value={prefs?.newVideoFps ?? 30} disabled={!prefs} onChange={(v) => change({ newVideoFps: v })} options={[{ value: 30, label: "30 fps" }, { value: 60, label: "60 fps" }]} />
      </Row>
      <Row title="Director's reply language" desc="The language of the director's chat messages and its closing summary. Text inside the video still follows what you ask for in your prompt.">
        <Seg label="Reply language" value={prefs?.replyLanguage ?? "auto"} disabled={!prefs} onChange={(v) => change({ replyLanguage: v })} options={[{ value: "auto", label: "Like my message" }, { value: "id", label: "Indonesian" }, { value: "en", label: "English" }]} />
      </Row>
      <Row title="Data folder" desc={dataDir ?? "Not available."}>
        {inTauri && dataDir !== null && <button type="button" onClick={() => void revealItemInDir(dataDir).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>Show in Finder</button>}
      </Row>
      <Row title="Reset settings" desc="Puts every setting in this dialog back to how Memotion ships. Providers, keys, projects and downloads stay.">
        {confirm ? (
          <div className="row">
            <button type="button" className="danger" onClick={() => void resetAll()}>Reset</button>
            <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)}>Reset…</button>
        )}
      </Row>
      {error && <div className="notice error">{error}</div>}
    </>
  );
}
