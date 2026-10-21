import type { Hono } from "hono";
import { z } from "zod";
import { snapshotProject } from "../engine/tools.js";
import { addComment, CommentInput, deleteComment, listComments, saveMarkImage } from "../marks/store.js";
import { readMeta } from "../projects/store.js";

const TimeQuery = z.coerce.number().min(0).max(3600);

export function registerMarkRoutes(app: Hono): void {
  app.get("/projects/:id/comments", async (c) => c.json(await listComments(c.req.param("id"))));
  app.post("/projects/:id/comments", async (c) => {
    const id = c.req.param("id");
    await readMeta(id);
    return c.json(await addComment(id, CommentInput.parse(await c.req.json())));
  });
  app.delete("/projects/:id/comments/:cid", async (c) => {
    const ok = await deleteComment(c.req.param("id"), c.req.param("cid"));
    return ok ? c.json({ ok: true }) : c.json({ error: "No such comment" }, 404);
  });

  // The frame the user is looking at, as a PNG, so the app can draw on it and send it back.
  app.get("/projects/:id/frame", async (c) => {
    const id = c.req.param("id");
    const t = TimeQuery.parse(c.req.query("t") ?? "0");
    const [shot] = await snapshotProject(id, [t], c.req.raw.signal);
    if (!shot) return c.json({ error: "Could not capture the frame" }, 500);
    return new Response(new Uint8Array(shot.bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  });

  app.post("/projects/:id/marks/image", async (c) => {
    const id = c.req.param("id");
    await readMeta(id);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    try {
      return c.json({ path: await saveMarkImage(id, bytes) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
}
