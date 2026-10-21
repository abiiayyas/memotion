import { useCallback, useEffect, useState } from "react";
import { api, rawUrl } from "../api";
import type { AppSettings, CaptureResult, Project } from "../types";

function Shot({ projectId, path }: { projectId: string; path: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void rawUrl(projectId, path).then(setSrc);
  }, [projectId, path]);
  return src ? <img src={src} alt="" className="shot" /> : <div className="shot" />;
}

export function SourcesPanel({
  project,
  onEdited,
  onAsk,
  openSettings,
}: {
  project: Project;
  onEdited: () => void;
  /** Send a message to the director as if the user typed it. */
  onAsk: (text: string) => void;
  openSettings: () => void;
}) {
  const [url, setUrl] = useState("");
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState<"square" | "landscape" | "portrait">(project.orientation);
  const [made, setMade] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState<"capture" | "image" | "kit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSettings = useCallback(() => api.settings().then(setSettings, () => setSettings(null)), []);
  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  async function run(kind: NonNullable<typeof busy>, job: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const doCapture = () =>
    run("capture", async () => {
      setCapture(await api.capture(project.id, url.trim()));
      onEdited();
    });

  const makeKit = () =>
    run("kit", async () => {
      if (!capture) return;
      const kit = await api.brandFromSite(capture.title || "Website", capture.tokens.colors, capture.tokens.fonts);
      setNotice(`Brand kit “${kit.name}” created from the site's colours and fonts. Open the Brand tab to review and apply it.`);
    });

  const toggleImages = (enabled: boolean) => run("image", async () => setSettings(await api.setImageGeneration(enabled)));

  const makeImage = () =>
    run("image", async () => {
      const res = await api.generateImage(project.id, prompt.trim(), shape);
      setMade((m) => [res.path, ...m]);
      setNotice(`Saved ${res.path}. Ask the director to use it, or find it in the Media tab.`);
      onEdited();
      await refreshSettings();
    });

  return (
    <div className="sources">
      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice okmsg">{notice}</div>}

      <div className="voice-grid">
        <div className="voice-section">
          <h3>Website</h3>
          <div className="row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-site.com" disabled={busy !== null} aria-label="Website address" onKeyDown={(e) => e.key === "Enter" && url.trim() && void doCapture()} />
            <button className="primary" onClick={() => void doCapture()} disabled={busy !== null || !url.trim()}>
              {busy === "capture" ? "Capturing…" : "Capture"}
            </button>
          </div>
          <div className="muted">Saves screenshots, images, colours, fonts and text under <code>assets/capture/</code>. Takes 15–60 s. Only public sites.</div>

          {capture && (
            <div className="capture">
              <strong>{capture.title}</strong>
              <div className="muted">{capture.dir}</div>
              <div className="shots">{capture.screenshots.slice(0, 4).map((s) => <Shot key={s} projectId={project.id} path={s} />)}</div>
              <div className="chips">
                {capture.tokens.colors.slice(0, 8).map((c) => <span key={c} className="chip" style={{ background: c }} title={c} />)}
                {capture.tokens.fonts.length > 0 && <span className="muted">{capture.tokens.fonts.join(", ")}</span>}
              </div>
              <div className="muted">{capture.assets.length} images, {capture.screenshots.length} screenshots{capture.warnings.length > 0 ? ` · ${capture.warnings[0]}` : ""}</div>
              <div className="row">
                <button onClick={() => void makeKit()} disabled={busy !== null}>Create brand kit from this site</button>
                <button onClick={() => onAsk(`Make a video for ${capture.title} using the website I captured in ${capture.dir}/. Use its real colours, its real text and its own images and screenshots.`)} disabled={busy !== null}>
                  Make a video from this site
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="voice-section">
          <h3>Generate an image (AI)</h3>
          {settings && !settings.imageGeneration ? (
            <div className="notice warn" style={{ margin: 0 }}>
              Image generation is off because every image costs money with your provider. Turn it on to let you, and the director, make images.
              <div className="row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void toggleImages(true)} disabled={busy !== null}>Turn on image generation</button>
              </div>
            </div>
          ) : (
            <>
              {settings?.imageBlocker && (
                <div className="notice warn" style={{ margin: 0 }}>
                  {settings.imageBlocker}{" "}
                  <button className="link" onClick={openSettings}>Open settings</button>
                </div>
              )}
              <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A steaming cup of coffee on a wooden table, warm morning light, shallow depth of field" disabled={busy !== null} aria-label="Image description" />
              <div className="row">
                <label>
                  Shape
                  <select value={shape} onChange={(e) => setShape(e.target.value as typeof shape)} disabled={busy !== null}>
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                    <option value="square">Square</option>
                  </select>
                </label>
                <button className="primary" onClick={() => void makeImage()} disabled={busy !== null || prompt.trim().length < 3 || settings?.imageBlocker != null}>
                  {busy === "image" ? "Generating…" : "Generate"}
                </button>
              </div>
              <div className="shots">{made.slice(0, 4).map((p) => <Shot key={p} projectId={project.id} path={p} />)}</div>
              <button className="link" onClick={() => void toggleImages(false)} disabled={busy !== null}>Turn off image generation</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
