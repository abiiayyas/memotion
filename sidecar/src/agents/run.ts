import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { getPreferences } from "../preferences.js";
import { buildBrief } from "../agent/brief.js";
import { localizeGsap } from "../projects/gsap.js";
import { claimProject, loadHistory, recordTurn, type AgentEvent } from "../agent/loop.js";
import { systemPrompt } from "../agent/prompt.js";
import { selfPort } from "../config.js";
import { getReviewerProvider } from "../providers/store.js";
import { previewEtag, waitPreviewChanged } from "../engine/preview.js";
import { listMedia, projectPath, readMeta } from "../projects/store.js";
import { childEnv, CLI_SPECS, findOnPath, type CliId } from "./cli.js";
import { claudeToolLabel, mayChangeFiles, parserFor } from "./events.js";
import { openRunScope } from "./mcp.js";

export interface Invocation {
  args: string[];
  /** Sent to the child's standard input (long prompts do not belong on the command line). */
  stdin?: string;
  env: Record<string, string>;
}

export interface InvocationInput {
  /** Full URL of this run's MCP endpoint. */
  mcpUrl: string;
  /** An empty folder to use as a config home, for CLIs that keep user settings there. */
  isolatedConfigDir: string;
  system: string;
  prompt: string;
  cwd: string;
}

/** Everything a CLI may do in a project: its own file tools, Memotion's MCP tools, nothing that reaches the network or the shell. */
const CLAUDE_ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "mcp__memotion"];
const CLAUDE_DENIED = ["Bash", "WebFetch", "WebSearch", "Task"];

/** The command line, input and environment for one run. Pure, so it can be checked without starting anything. */
export function buildInvocation(id: CliId, input: InvocationInput): Invocation {
  if (id === "claude") {
    return {
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        // Skip the user's own hooks, plugins and MCP servers: a broken personal hook blocked every prompt in testing.
        // Sign-in is not a setting, so the user's login still applies.
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--mcp-config",
        JSON.stringify({ mcpServers: { memotion: { type: "http", url: input.mcpUrl } } }),
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        ...CLAUDE_ALLOWED,
        "--disallowedTools",
        ...CLAUDE_DENIED,
        "--append-system-prompt",
        input.system,
      ],
      stdin: input.prompt,
      env: {},
    };
  }
  const prompt = `<instructions>\n${input.system}\n</instructions>\n\n<request>\n${input.prompt}\n</request>`;
  if (id === "codex") {
    return {
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        // Writes stay inside the project and the shell has no network.
        "-s",
        "workspace-write",
        // The user's own MCP servers and plugins are not part of this job.
        "--ignore-user-config",
        "-c",
        `mcp_servers.memotion.url=${JSON.stringify(input.mcpUrl)}`,
        // Exec mode cannot ask the user; without this Codex refuses every MCP tool ("approval policy is never").
        "-c",
        'mcp_servers.memotion.default_tools_approval_mode="approve"',
        "-C",
        input.cwd,
        "-",
      ],
      stdin: prompt,
      env: {},
    };
  }
  return {
    args: ["run", "--format", "json", "--dir", input.cwd, prompt],
    env: {
      // Its settings (and so the user's own MCP servers and plugins) live under XDG_CONFIG_HOME; sign-in is in the
      // data folder, which stays. An empty config folder leaves only what Memotion passes below.
      XDG_CONFIG_HOME: input.isolatedConfigDir,
      // It also reads Claude Code's skills and prompts from the home folder.
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: { memotion: { type: "remote", url: input.mcpUrl, enabled: true } },
        permission: { bash: "deny", webfetch: "deny", external_directory: "deny" },
      }),
    },
  };
}

const TAIL = 600;
const RECENT_TURNS = 6;
const RECENT_CHARS = 1500;

/**
 * Each CLI run starts fresh (nothing is carried over unless we say so), so "make it bigger" would mean nothing.
 * The last few exchanges go in front of the new message; the CLI re-reads the project files for everything else.
 */
export function withRecentConversation(history: { role: string; content?: unknown }[], message: string): string {
  const turns = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
    .slice(-RECENT_TURNS)
    .map((m) => `${m.role === "user" ? "User" : "You"}: ${String(m.content).slice(0, RECENT_CHARS)}`);
  return turns.length === 0 ? message : `Earlier in this conversation:\n${turns.join("\n\n")}\n\nNew message from the user:\n${message}`;
}

/** The last few lines of stderr that say something, without the noise CLIs print (hooks, update notices). */
function stderrSummary(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/hook|update available|^\s*at /i.test(l));
  return lines.slice(-4).join(" ").slice(-TAIL);
}

type Child = ReturnType<typeof spawn>;

const active: Record<number, Child | undefined> = {};

/**
 * Stop the CLI and everything it started. Agents run shell commands and helper processes; killing only the parent
 * leaves those holding our pipes open, so the run would hang until they finish. The child leads its own process
 * group (see spawn below), and the group gets the signal.
 */
function killTree(child: Child, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

function killLater(child: Child): void {
  killTree(child, "SIGTERM");
  setTimeout(() => killTree(child, "SIGKILL"), 3000).unref();
}

/** Called when the app quits, so no agent keeps working on a project nobody is watching. */
export function stopAllAgents(): void {
  for (const child of Object.values(active)) if (child) killTree(child, "SIGKILL");
}

/**
 * One user turn handled by a coding-agent CLI running inside the project folder. Its stream is reduced to the same
 * events the API director emits, so the chat view and the preview reload do not care who is writing.
 */
export async function* runCliAgent(projectId: string, userText: string, signal: AbortSignal, id: CliId): AsyncGenerator<AgentEvent> {
  const release = claimProject(projectId);
  if (!release) {
    yield { type: "error", message: "The agent is already working on this project." };
    return;
  }
  const scope = openRunScope(projectId, signal);
  const cleanup: (() => Promise<void>)[] = [];
  try {
    const spec = CLI_SPECS[id];
    if (spec.unsupported) {
      yield { type: "error", message: `${spec.label} cannot be used as the director: ${spec.unsupported}` };
      return;
    }
    const binary = await findOnPath(spec.binary);
    if (!binary) {
      yield { type: "error", message: `${spec.label} was not found on this computer. Install it (${spec.install}), then choose it again in Settings.` };
      return;
    }

    const meta = await readMeta(projectId);
    const media = (await listMedia(projectId)).map((m) => `${m.path} (${m.kind})`);
    const brief = await buildBrief(meta);
    brief.reviewer = getReviewerProvider() !== undefined && getPreferences().maxReviews > 0;
    const system = systemPrompt(meta, media, brief, true);
    const cwd = projectPath(projectId);
    const isolatedConfigDir = await mkdtemp(join(tmpdir(), "memotion-cfg-"));
    cleanup.push(() => rm(isolatedConfigDir, { recursive: true, force: true }));
    const prompt = withRecentConversation(await loadHistory(projectId), userText);
    const inv = buildInvocation(id, { isolatedConfigDir, mcpUrl: `http://127.0.0.1:${selfPort()}${scope.path}`, system, prompt, cwd });

    const child = spawn(binary, inv.args, { cwd, env: await childEnv(inv.env), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    if (child.pid !== undefined) active[child.pid] = child;
    const onAbort = () => killLater(child);
    signal.addEventListener("abort", onAbort, { once: true });

    let stderr = "";
    const exited = Promise.withResolvers<number | null>();
    child.once("error", (err) => {
      stderr += `${err.message}\n`;
      exited.resolve(null);
    });
    child.once("close", (code) => {
      if (child.pid !== undefined) active[child.pid] = undefined;
      exited.resolve(code);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(inv.stdin ?? "");

    const parse = parserFor(id);
    const names: Record<string, string> = {};
    let finalText = "";
    let failure: string | null = null;
    let lastReload = 0;
    let dirty = false;
    const before = await previewEtag(projectId);

    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      for (const ev of parse(line)) {
        if (ev.type === "text") {
          finalText += (finalText ? "\n\n" : "") + ev.text;
          yield { type: "text", text: ev.text };
        } else if (ev.type === "tool-start") {
          const label = id === "claude" ? claudeToolLabel(ev.name, ev.args) : ev.name;
          names[ev.id] = ev.name;
          yield { type: "tool-start", id: ev.id, name: label, args: ev.args };
        } else if (ev.type === "tool-result") {
          yield { type: "tool-result", id: ev.id, ok: ev.ok, summary: ev.summary };
          if (mayChangeFiles(names[ev.id] ?? "")) dirty = true;
        } else {
          failure = ev.message;
        }
      }
      // Reload the preview while it works, but not on every tool.
      if (dirty && Date.now() - lastReload > 2000) {
        dirty = false;
        lastReload = Date.now();
        await waitPreviewChanged(projectId, before);
        yield { type: "files-changed" };
      }
    }
    const code = await exited.promise;
    signal.removeEventListener("abort", onAbort);

    await recordTurn(projectId, userText, finalText);
    if ((await localizeGsap(projectId).catch(() => [])).length > 0) dirty = true;
    if (dirty || lastReload > 0) yield { type: "files-changed" };

    if (signal.aborted) {
      yield { type: "error", message: "Cancelled." };
    } else if (failure) {
      yield { type: "error", message: failure };
    } else if (code !== 0) {
      const why = stderrSummary(stderr);
      yield { type: "error", message: `${spec.label} stopped with exit code ${code ?? "unknown"}${why ? `: ${why}` : ""}${/login|auth|sign/i.test(stderr) ? ` Sign in with: ${spec.signIn}` : ""}` };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: signal.aborted ? "Cancelled." : err instanceof Error ? err.message : String(err) };
  } finally {
    scope.close();
    await Promise.all(cleanup.map((fn) => fn()));
    release();
  }
}
