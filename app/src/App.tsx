import { useCallback, useEffect, useState } from "react";
import { api, connect } from "./api";
import { Chat } from "./components/Chat";
import { ExportPanel } from "./components/Export";
import { MediaPanel } from "./components/Media";
import { Preview } from "./components/Preview";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import { VariablesPanel } from "./components/Variables";
import { VoicePanel } from "./components/VoicePanel";
import { usePlayer } from "./player";
import type { Project } from "./types";

type Tab = "timeline" | "variables" | "voice" | "media" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "variables", label: "Variables" },
  { id: "voice", label: "Voice & Captions" },
  { id: "media", label: "Media" },
  { id: "export", label: "Export" },
];

export function App() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("timeline");
  const player = usePlayer();

  const refreshProviders = useCallback(async () => {
    const { providers, activeProviderId } = await api.providers();
    const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];
    setHasProvider(Boolean(active?.hasKey && active.model));
  }, []);

  useEffect(() => {
    (async () => {
      await connect();
      const list = await api.projects();
      setProjects(list);
      setCurrentId(list[0]?.id ?? null);
      await refreshProviders();
      setReady(true);
    })().catch((e: Error) => setFatal(e.message));
  }, [refreshProviders]);

  const current = projects.find((p) => p.id === currentId) ?? null;
  const rememberTime = player.rememberTime;
  /** Files changed (agent, timeline edit, variable): reload the preview but keep the playhead where it was. */
  const reload = useCallback(() => {
    rememberTime();
    setReloadKey((k) => k + 1);
  }, [rememberTime]);

  if (fatal) return <div className="splash error">Could not start: {fatal}</div>;
  if (!ready) return <div className="splash">Starting…</div>;

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        currentId={currentId}
        onSelect={setCurrentId}
        onCreated={(p) => {
          setProjects((prev) => [p, ...prev]);
          setCurrentId(p.id);
        }}
        onDeleted={(id) => {
          const rest = projects.filter((p) => p.id !== id);
          setProjects(rest);
          if (currentId === id) setCurrentId(rest[0]?.id ?? null);
        }}
        openSettings={() => setSettingsOpen(true)}
      />
      {current ? (
        <>
          <main className="center">
            <Preview key={current.id} project={current} reloadKey={reloadKey} player={player} />
            <div className="tabs">
              <div role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className={`tab-body ${tab}`}>
                {tab === "timeline" && <Timeline key={current.id} project={current} player={player} reloadKey={reloadKey} onEdited={reload} />}
                {tab === "variables" && <VariablesPanel project={current} reloadKey={reloadKey} onEdited={reload} />}
                {tab === "voice" && <VoicePanel project={current} onEdited={reload} />}
                {tab === "media" && <MediaPanel project={current} onChanged={reload} />}
                {tab === "export" && <ExportPanel project={current} />}
              </div>
            </div>
          </main>
          <Chat key={current.id} project={current} onFilesChanged={reload} hasProvider={hasProvider} openSettings={() => setSettingsOpen(true)} />
        </>
      ) : (
        <main className="center empty-state">
          <h1>Make a video from a prompt</h1>
          <p>Create a project, choose 16:9 or 9:16, then describe what you want.</p>
          {!hasProvider && (
            <button className="primary" onClick={() => setSettingsOpen(true)}>
              Connect an AI provider
            </button>
          )}
        </main>
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onChanged={() => void refreshProviders()} />}
    </div>
  );
}
