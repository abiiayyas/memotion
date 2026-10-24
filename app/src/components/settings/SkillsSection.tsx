import { useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../../api";
import { skillsChanged, useSkills } from "../../skills";
import type { Skill } from "../../types";
import { PathField } from "../PathField";
import { Notice, Row } from "./Rows";

const inTauri = "__TAURI_INTERNALS__" in window;

function size(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Skills the director can follow: installed from a GitHub link or a folder, attached to a video from its Structure row. */
export function SkillsSection() {
  const skills = useSkills();
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function install(job: () => Promise<Skill>, done: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const skill = await job();
      setNotice(`“${skill.name}” is installed (${skill.files.length} files). Pick it on Home or above a video's message box.`);
      done();
      skillsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setNotice(null);
    try {
      await api.removeSkill(id);
      setConfirm(null);
      skillsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const openSource = (s: Skill) => {
    if (s.origin === "folder") void revealItemInDir(s.source);
    else if (inTauri) void openUrl(s.source);
    else window.open(s.source, "_blank", "noopener");
  };

  return (
    <>
      <Row
        title="Install from GitHub"
        desc="Paste a GitHub link: a repository with one skill in it, or the link to a skill's folder. A skill is a SKILL.md with instructions the director follows (a design method, a house style). Only its text documents are downloaded and nothing in it is run. Its text goes into the director's prompt, so install skills you trust."
        stack
      >
        <div className="row" style={{ width: "100%", flexWrap: "nowrap" }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url.trim() && void install(() => api.installSkill(url.trim()), () => setUrl(""))}
            placeholder="https://github.com/owner/repo"
            aria-label="Skill link"
            disabled={busy}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={() => void install(() => api.installSkill(url.trim()), () => setUrl(""))} disabled={busy || !url.trim()}>{busy ? "Installing…" : "Install"}</button>
        </div>
      </Row>
      <Row
        title="Import from a folder"
        desc="Already have a skill on this computer, for example one that npx installed into ~/.claude/skills? Choose its folder (or a folder that holds exactly one skill). It is copied, so the original stays where it is and later changes there are not picked up until you import it again."
        stack
      >
        <div className="row" style={{ width: "100%", flexWrap: "nowrap" }}>
          <div style={{ flex: 1 }}>
            <PathField label="Skill folder" value={folder} onChange={setFolder} placeholder="/path/to/skill-folder" directory disabled={busy} />
          </div>
          <button className="primary" onClick={() => void install(() => api.importSkillFolder(folder.trim()), () => setFolder(""))} disabled={busy || !folder.trim()}>Import</button>
        </div>
      </Row>
      {error && <Notice kind="error"><span style={{ whiteSpace: "pre-wrap" }}>{error}</span></Notice>}
      {notice && <Notice kind="ok">{notice}</Notice>}
      <div className="sd-block">
        <h3>Installed</h3>
        {skills.length === 0 && <Row title="No skills yet" desc="Install one above and it shows up here." />}
        {skills.map((s) => (
          <Row key={s.id} title={s.name} desc={`${s.description.length > 220 ? `${s.description.slice(0, 220)}…` : s.description || "No description."} · ${s.files.length} files, ${size(s.bytes)}${s.origin === "folder" ? ` · from ${s.source}` : ""}`}>
            {confirm === s.id ? (
              <div className="row">
                <button type="button" className="danger" onClick={() => void remove(s.id)}>Remove</button>
                <button type="button" onClick={() => setConfirm(null)}>Keep</button>
              </div>
            ) : (
              <div className="row">
                {(s.origin === "github" || inTauri) && (
                  <button type="button" className="link" onClick={() => openSource(s)}>{s.origin === "folder" ? "Show folder" : "Source"}</button>
                )}
                <button type="button" onClick={() => setConfirm(s.id)}>Remove…</button>
              </div>
            )}
          </Row>
        ))}
      </div>
    </>
  );
}
