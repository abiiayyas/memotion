import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { ensurePreview } from "../engine/preview.js";
import { PICK_SCRIPT } from "./inject.js";

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Response headers worth passing on. Length is dropped for pages we rewrite. */
const PASS = ["content-type", "content-range", "accept-ranges", "etag", "last-modified", "cache-control", "content-length"];
const FORWARD = ["range", "if-none-match", "if-modified-since", "accept"];

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The Studio's page, with the pick script added and its two absolute URLs (`<base>` and the runtime script) pointed
 * back at this proxy. Measured on a real preview page: those are the only absolute URLs it contains.
 */
export function rewritePreviewHtml(html: string, prefix: string): string {
  const pointed = html.replaceAll('"/api/', `"${prefix}/api/`).replaceAll("'/api/", `'${prefix}/api/`);
  const tag = `<script>${PICK_SCRIPT}</script>`;
  const at = pointed.lastIndexOf("</body>");
  return at === -1 ? `${pointed}${tag}` : `${pointed.slice(0, at)}${tag}${pointed.slice(at)}`;
}

/**
 * Serves each project's Studio preview under /pv/<token>/<project>/..., so the app's preview frame comes from the
 * sidecar and the app can ask the page questions (see inject.ts). The token in the path is the sidecar's own: an iframe
 * cannot send a header, and every later request (scripts, assets) inherits the path.
 */
export function registerPreviewProxy(app: Hono, token: string): void {
  app.on(["GET", "HEAD"], "/pv/:token/:id/*", async (c) => {
    if (!sameToken(c.req.param("token"), token)) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.param("id");
    if (!ID.test(id)) return c.json({ error: "bad project id" }, 400);

    const prefix = `/pv/${c.req.param("token")}/${id}`;
    const rest = c.req.path.slice(prefix.length + 1);
    // Only the Studio's API surface: never an arbitrary path on that server.
    if (!rest.startsWith("api/") || rest.includes("..")) return c.json({ error: "not found" }, 404);

    const { port } = await ensurePreview(id);
    const query = new URL(c.req.url).search;
    const headers: Record<string, string> = {};
    for (const h of FORWARD) {
      const v = c.req.header(h);
      if (v) headers[h] = v;
    }
    const upstream = await fetch(`http://127.0.0.1:${port}/${rest}${query}`, { method: c.req.method, headers, redirect: "manual" });

    const out = new Headers();
    for (const h of PASS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    if ((upstream.headers.get("content-type") ?? "").includes("text/html") && upstream.status === 200) {
      const html = rewritePreviewHtml(await upstream.text(), prefix);
      out.delete("content-length");
      out.delete("etag");
      out.set("cache-control", "no-store");
      return new Response(c.req.method === "HEAD" ? null : html, { status: 200, headers: out });
    }
    return new Response(c.req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
  });
}
