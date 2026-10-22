import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../../api";
import type { AboutInfo } from "../../types";
import { Row } from "./Rows";

const inTauri = "__TAURI_INTERNALS__" in window;

const LICENSES: { name: string; licence: string; url: string; note: string }[] = [
  { name: "HyperFrames", licence: "Apache-2.0", url: "https://github.com/heygen-com/hyperframes", note: "The video format and the renderer Memotion drives." },
  { name: "FFmpeg", licence: "LGPL / GPL, depending on the build", url: "https://ffmpeg.org/legal.html", note: "Not bundled: Memotion uses the copy installed on this computer." },
  { name: "GSAP", licence: "GreenSock Standard License", url: "https://gsap.com/standard-license", note: "Not in Memotion's source: downloaded once and kept in the data folder." },
  { name: "whisper.cpp", licence: "MIT", url: "https://github.com/ggml-org/whisper.cpp", note: "Built on this computer only if you allow it, for transcribing." },
  { name: "sherpa-onnx and Piper voices", licence: "Apache-2.0 and per-voice licences", url: "https://github.com/k2-fsa/sherpa-onnx", note: "Downloaded only if you install an offline voice." },
];

export function AboutSection() {
  const [about, setAbout] = useState<AboutInfo | null>(null);
  useEffect(() => {
    void api.about().then(setAbout, () => setAbout(null));
  }, []);
  const open = (url: string) => (inTauri ? void openUrl(url) : window.open(url, "_blank", "noopener"));
  return (
    <>
      <Row title="Memotion" desc={`Version ${__APP_VERSION__}. A private desktop app: you describe a video, a director writes it as HTML and GSAP, and it renders to MP4.`} />
      <Row title="HyperFrames" desc={about ? `Version ${about.hyperframes}, pinned. Memotion was tested with this one.` : "…"} />
      <div className="sd-block">
        <h3>Open-source software</h3>
        {LICENSES.map((l) => (
          <Row key={l.name} title={`${l.name} · ${l.licence}`} desc={l.note}>
            <button type="button" className="link" onClick={() => open(l.url)}>Licence and source</button>
          </Row>
        ))}
      </div>
    </>
  );
}
