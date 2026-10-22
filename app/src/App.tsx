import { useCallback, useEffect, useState } from "react";
import { api, connect } from "./api";
import { AllProjects } from "./components/AllProjects";
import { BrandKits } from "./components/BrandKits";
import { Editor } from "./components/Editor";
import { Home } from "./components/Home";
import { ImportDialog } from "./components/ImportDialog";
import { Settings } from "./components/Settings";
import { Sidebar, type View } from "./components/Sidebar";
import { useMarkState } from "./marks";
import { usePlayer } from "./player";
import type { AgentBackend, Project } from "./types";

const AGENT_LABEL: Record<AgentBackend, string> = {
  api: "AI provider",
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  agy: "Antigravity",
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
    <div className={`app ${collapsed || inEditor ? "rail" : ""}`}>
      <Sidebar
        projects={projects}
        view={inEditor ? "project" : view === "project" ? "home" : view}
        currentId={currentId}
        collapsed={collapsed || inEditor}
        lockedRail={inEditor}
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
        <Editor
          project={current}
          reloadKey={reloadKey}
          onReload={reload}
          player={player}
          marks={marks}
          hasProvider={hasProvider}
          agentLabel={AGENT_LABEL[backend]}
          openSettings={() => setSettingsOpen(true)}
          autoSend={autoPrompt?.projectId === current.id ? autoPrompt.text : null}
          onAutoSent={() => setAutoPrompt(null)}
          onAsk={(text) => setAutoPrompt({ projectId: current.id, text })}
          onProjectChanged={() => void refreshProjects()}
          onRenamed={(renamed) => setProjects((prev) => prev.map((x) => (x.id === renamed.id ? renamed : x)))}
          onHome={() => setView("home")}
        />
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
            if (prompt) setAutoPrompt({ projectId: project.id, text: prompt });
          }}
        />
      )}
    </div>
  );
}
