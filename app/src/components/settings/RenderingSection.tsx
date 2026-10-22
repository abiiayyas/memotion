import { useEffect, useState } from "react";
import { api } from "../../api";
import { usePrefs } from "../../prefs";
import type { AboutInfo } from "../../types";
import { SystemStatus } from "../SystemStatus";
import { Row, Seg } from "./Rows";

export function RenderingSection() {
  const { prefs, update } = usePrefs();
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.about().then(setAbout, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function downloadGsap() {
    setBusy(true);
    setError(null);
    try {
      setAbout(await api.downloadGsap());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Row title="Export quality" desc="What the Export dialog starts with. You can still change it for each export.">
        <Seg label="Export quality" value={prefs?.exportQuality ?? "standard"} disabled={!prefs} onChange={(v) => void update({ exportQuality: v })} options={[{ value: "draft", label: "Draft" }, { value: "standard", label: "Standard" }, { value: "high", label: "High" }]} />
      </Row>
      <Row title="Export frame rate" desc="“Same as the video” renders at the rate the video was made for.">
        <Seg label="Export frame rate" value={prefs?.exportFps ?? "project"} disabled={!prefs} onChange={(v) => void update({ exportFps: v })} options={[{ value: "project", label: "Same as the video" }, { value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }]} />
      </Row>
      <Row title="Offline animation library" desc={about ? `GSAP ${about.gsap}. ${about.gsapCached ? "A checked copy is stored, so previews and renders work without internet." : "No copy stored yet. It is downloaded once, from the same address projects used before, and checked against a pinned fingerprint."}` : "…"}>
        <button type="button" onClick={() => void downloadGsap()} disabled={busy || about === null}>{busy ? "Downloading…" : about?.gsapCached ? "Check again" : "Download"}</button>
      </Row>
      {error && <div className="notice error">{error}</div>}
      <SystemStatus />
    </>
  );
}
