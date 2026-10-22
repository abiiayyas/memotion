import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { cliEnv, hyperframesBin } from "../config.js";
import { localizeGsap } from "../projects/gsap.js";
import { projectPath } from "../projects/store.js";

interface Preview {
  port: number;
  child: ChildProcess;
  ready: Promise<void>;
}

const previews = new Map<string, Preview>();

async function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const srv = createServer();
  srv.once("error", reject);
  srv.listen(0, "127.0.0.1", () => {
    const addr = srv.address();
    srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
  });
  return promise;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Studio preview exited early (code ${child.exitCode})`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/projects`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error("Studio preview did not start within 45 s");
}

/**
 * One `hyperframes preview` Studio server per project. The studio serves the runtime-injected
 * composition at /api/projects/<id>/preview, which the UI embeds in an iframe and drives with postMessage.
 */
export async function ensurePreview(id: string): Promise<{ port: number; url: string }> {
  let p = previews.get(id);
  if (!p || p.child.exitCode !== null) {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [hyperframesBin(), "preview", projectPath(id), "--port", String(port), "--no-open", "--foreground", "--force-new"],
      { env: cliEnv({ HYPERFRAMES_PREVIEW_HOST: "127.0.0.1" }), stdio: "ignore" },
    );
    p = { port, child, ready: waitReady(port, child) };
    previews.set(id, p);
    child.once("exit", () => {
      if (previews.get(id)?.child === child) previews.delete(id);
    });
  }
  try {
    await p.ready;
  } catch (err) {
    p.child.kill();
    previews.delete(id);
    throw err;
  }
  // The Studio names the project after its directory, which is our project id.
  return { port: p.port, url: `http://127.0.0.1:${p.port}/api/projects/${id}/preview` };
}

/** The Studio's validator for the composition it would serve right now; null when no preview is running. */
export async function previewEtag(id: string): Promise<string | null> {
  const p = previews.get(id);
  if (!p || p.child.exitCode !== null) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${p.port}/api/projects/${id}/preview`, { method: "HEAD" });
    return res.headers.get("etag");
  } catch {
    return null;
  }
}

const POLL_MS = 25;
/** The Studio's watcher can deliver the last of several writes slightly after the first; require a quiet period. */
const SETTLE_MS = 90;

/**
 * The Studio server notices file writes a few tens of milliseconds late (measured: a request right after a
 * write gets the previous composition about one time in four). A preview reloaded in that window stays stale.
 * Wait until its ETag differs from `before` and has stopped changing; give up after `timeoutMs`, because an
 * edit that does not alter the composition (a README, an identical value) never changes it.
 */
export async function waitPreviewChanged(id: string, before: string | null, timeoutMs = 1500): Promise<void> {
  if (before === null) return;
  const deadline = Date.now() + timeoutMs;
  let last = before;
  let lastChange = 0;
  while (Date.now() < deadline) {
    const now = await previewEtag(id);
    if (now === null) return;
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    } else if (last !== before && Date.now() - lastChange >= SETTLE_MS) {
      return;
    }
    await sleep(POLL_MS);
  }
}

/** Run `op` (which writes project files), then return only once the preview server serves the result. */
export async function withFreshPreview<T>(id: string, op: () => Promise<T>): Promise<T> {
  const before = await previewEtag(id);
  const result = await op();
  // Whatever the operation wrote (captions, a variable) may load GSAP from the CDN: point it at the local copy.
  await localizeGsap(id).catch(() => []);
  await waitPreviewChanged(id, before);
  return result;
}

export function stopPreview(id: string): void {
  previews.get(id)?.child.kill();
  previews.delete(id);
}

export function stopAllPreviews(): void {
  for (const p of previews.values()) p.child.kill();
  previews.clear();
}
