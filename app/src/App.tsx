import { useCallback, useEffect, useState } from "react";
import { api, connect } from "./api";
import { AllProjects } from "./components/AllProjects";
import { BrandKits } from "./components/BrandKits";
import { BrandPanel } from "./components/Brand";
import { Chat } from "./components/Chat";
import { ExportPanel } from "./components/Export";
import { Home } from "./components/Home";
import { ImportDialog } from "./components/ImportDialog";
import { MediaPanel } from "./components/Media";
import { Preview } from "./components/Preview";
import { Settings } from "./components/Settings";
import { Sidebar, type View } from "./components/Sidebar";
import { SourcesPanel } from "./components/Sources";
import { Timeline } from "./components/Timeline";
import { CommentsPanel } from "./components/Comments";
import { VariablesPanel } from "./components/Variables";
import { VoicePanel } from "./components/VoicePanel";
import { useMarkState } from "./marks";
import { usePlayer } from "./player";
import type { AgentBackend, Project } from "./types";

type Tab = "timeline" | "comments" | "variables" | "voice" | "media" | "sources" | "brand" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "comments", label: "Comments" },
  { id: "variables", label: "Variables" },
  { id: "voice", label: "Voice & Captions" },
  { id: "media", label: "Media" },
  { id: "sources", label: "Sources" },
  { id: "brand", label: "Brand" },
  { id: "export", label: "Export" },
];

const AGENT_LABEL: Record<AgentBackend, string> = {
  api: "AI provider",
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const SIDEBAR_KEY = "memotion.sidebar";

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "rail";
  } catch {
    return false;
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** Opening the app lands on Home: a prompt box, not an editor. */
  const [view, setView] = useState<View>("home");
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const [searchTick, setSearchTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);
  const [backend, setBackend] = useState<AgentBackend>("api");
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("timeline");
  /** A message for the director that another panel queued, tied to the project it is for. */
  const [autoPrompt, setAutoPrompt] = useState<{ projectId: string; text: string } | null>(null);
  const player = usePlayer();
  const marks = useMarkState(currentId);

  const refreshProviders = useCallback(async () => {
    const [{ providers, activeProviderId }, { backend }] = await Promise.all([api.providers(), api.agentBackend()]);
    const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];
    setBackend(backend);
    // A coding agent on this computer needs no API key.
    setHasProvider(backend !== "api" || Boolean(active?.hasKey && active.model));
  }, []);

  const refreshProjects = useCallback(async () => setProjects(await api.projects()), []);

  useEffect(() => {
    (async () => {
      await connect();
      const list = await api.projects();
      setProjects(list);
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

  const openProject = (id: string) => {
    setCurrentId(id);
    setView("project");
  };
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "full" : "rail");
      } catch {
        // the choice just is not remembered
      }
      return !c;
    });
  const inEditor = view === "project" && current !== null;

  if (fatal) return <div className="splash error">Could not start: {fatal}</div>;
  if (!ready) return <div className="splash">Starting…</div>;

  return (
    <div className={`app ${inEditor ? "" : "pages"} ${collapsed ? "rail" : ""}`}>
      <Sidebar
        projects={projects}
        view={inEditor ? "project" : view === "project" ? "home" : view}
        currentId={currentId}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onHome={() => setView("home")}
        onBrandKits={() => setView("brand-kits")}
        onAllProjects={() => setView("projects")}
        onSearch={() => {
          setView("projects");
          setSearchTick((n) => n + 1);
        }}
        onSelect={openProject}
        openSettings={() => setSettingsOpen(true)}
        openImport={() => setImportOpen(true)}
      />
      {inEditor && current ? (
        <>
          <main className="center">
            <Preview key={current.id} project={current} reloadKey={reloadKey} player={player} marks={marks} />
            <div className="tabs">
              <div role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                    {t.label}
                    {t.id === "comments" && marks.comments.some((c) => c.status === "open") ? ` (${marks.comments.filter((c) => c.status === "open").length})` : ""}
                  </button>
                ))}
              </div>
              <div className={`tab-body ${tab}`}>
                {tab === "timeline" && <Timeline key={current.id} project={current} player={player} reloadKey={reloadKey} onEdited={reload} />}
                {tab === "comments" && (
                  <CommentsPanel project={current} marks={marks} onAsk={(text) => setAutoPrompt({ projectId: current.id, text })} onSeek={player.seek} />
                )}
                {tab === "variables" && <VariablesPanel project={current} reloadKey={reloadKey} onEdited={reload} />}
                {tab === "voice" && <VoicePanel project={current} onEdited={reload} />}
                {tab === "media" && <MediaPanel project={current} onChanged={reload} />}
                {tab === "sources" && (
                  <SourcesPanel project={current} onEdited={reload} onAsk={(text) => setAutoPrompt({ projectId: current.id, text })} openSettings={() => setSettingsOpen(true)} />
                )}
                {tab === "brand" && <BrandPanel key={current.id} project={current} onProjectChanged={() => void refreshProjects()} onEdited={reload} />}
                {tab === "export" && <ExportPanel project={current} />}
              </div>
            </div>
          </main>
          <Chat
            key={current.id}
            project={current}
            onFilesChanged={reload}
            hasProvider={hasProvider}
            agentLabel={AGENT_LABEL[backend]}
            marks={marks}
            openSettings={() => setSettingsOpen(true)}
            autoSend={autoPrompt?.projectId === current.id ? autoPrompt.text : null}
            onAutoSent={() => setAutoPrompt(null)}
          />
        </>
      ) : view === "brand-kits" ? (
        <BrandKits onChanged={() => void refreshProjects()} />
      ) : view === "projects" ? (
        <AllProjects
          projects={projects}
          focusSearch={searchTick}
          onOpen={openProject}
          onDeleted={(id) => {
            setProjects((prev) => prev.filter((p) => p.id !== id));
            if (currentId === id) setCurrentId(null);
          }}
        />
      ) : (
        <Home
          projects={projects}
          hasProvider={hasProvider}
          backend={backend}
          openSettings={() => setSettingsOpen(true)}
          onBackendChanged={() => void refreshProviders()}
          onOpen={openProject}
          onShowAll={() => setView("projects")}
          onStarted={(project, prompt) => {
            setProjects((prev) => [project, ...prev]);
            setCurrentId(project.id);
            setView("project");
            setTab("timeline");
            // The director starts on its own: the user already said what they want.
            setAutoPrompt({ projectId: project.id, text: prompt });
          }}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} onChanged={() => void refreshProviders()} />}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(project, prompt) => {
            setProjects((prev) => [project, ...prev]);
            setCurrentId(project.id);
            setView("project");
            setTab("timeline");
            if (prompt) setAutoPrompt({ projectId: project.id, text: prompt });
          }}
        />
      )}
    </div>
  );
}
