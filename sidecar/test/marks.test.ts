import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent/loop.js";
import { addComment, ChatContext, deleteComment, describeTarget, listComments, renderContext, saveMarkImage, Target } from "../src/marks/store.js";
import { PICK_SCRIPT } from "../src/preview/inject.js";
import { rewritePreviewHtml } from "../src/preview/proxy.js";
import { createProject, projectPath } from "../src/projects/store.js";
import { upsertProvider } from "../src/providers/store.js";
import { buildApp } from "../src/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-marks-"));
process.env.MEMOTION_DATA_DIR = dataDir;
process.env.MEMOTION_API_KEY_MARKMOCK = "sk-test";
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

const target = Target.parse({
  selector: "#cta-title",
  id: "cta-title",
  tag: "h1",
  text: "Mampir ke Jl. Melati 12",
  rect: { x: 130, y: 609, w: 819, h: 309 },
  compositionFile: "compositions/cta.html",
  compositionId: "cta",
  start: "0",
  duration: "4",
  styles: { color: "rgb(255, 244, 230)", fontSize: "72px" },
});

describe("what the director is told about a marked element", () => {
  it("names the selector, the text, the file, the place and the style", () => {
    const text = describeTarget(target);
    expect(text).toContain("`#cta-title` <h1> showing \"Mampir ke Jl. Melati 12\"");
    expect(text).toContain("in compositions/cta.html");
    expect(text).toContain("x=130 y=609, 819×309 px");
    expect(text).toContain("fontSize: 72px");
  });

  it("refuses values a web page could use to flood or smuggle: over-long strings are rejected, not trimmed", () => {
    expect(Target.safeParse({ ...target, text: "x".repeat(5000) }).success).toBe(false);
    expect(Target.safeParse({ ...target, selector: "" }).success).toBe(false);
    expect(ChatContext.safeParse({ drawing: { imagePath: "../../etc/passwd", time: 1 } }).success).toBe(false);
    expect(ChatContext.safeParse({ drawing: { imagePath: ".memotion/marks/mark-abc123.png", time: 1 } }).success).toBe(true);
  });
});

describe("comments and mark images", () => {
  let projectId = "";
  beforeAll(async () => {
    projectId = (await createProject({ name: "Marks", orientation: "portrait" })).id;
  });

  it("keeps comments across reads, in order, and deletes one by id", async () => {
    const a = await addComment(projectId, { time: 1.5, x: 100, y: 200, text: "Bigger please", target });
    const b = await addComment(projectId, { time: 4, x: 10, y: 20, text: "Change the number" });
    expect((await listComments(projectId)).map((c) => c.text)).toEqual(["Bigger please", "Change the number"]);
    expect(a.status).toBe("open");
    expect(await deleteComment(projectId, a.id)).toBe(true);
    expect(await deleteComment(projectId, a.id)).toBe(false);
    expect((await listComments(projectId)).map((c) => c.id)).toEqual([b.id]);
  });

  it("saves only real PNGs, inside the project's marks folder, and keeps the newest 20", async () => {
    await expect(saveMarkImage(projectId, Buffer.from("not a png at all"))).rejects.toThrow(/PNG/);
    await expect(saveMarkImage(projectId, Buffer.alloc(8_100_000, 1))).rejects.toThrow(/too large/);
    const first = await saveMarkImage(projectId, PNG);
    expect(first).toMatch(/^\.memotion\/marks\/mark-[a-z0-9]+\.png$/);
    expect(existsSync(join(projectPath(projectId), first))).toBe(true);
    for (let i = 0; i < 24; i++) await saveMarkImage(projectId, PNG);
    expect(readdirSync(join(projectPath(projectId), ".memotion", "marks"))).toHaveLength(20);
  });

  it("renders selection, drawing and comments as one block, and attaches the drawing's image", async () => {
    const path = await saveMarkImage(projectId, PNG);
    const comment = await addComment(projectId, { time: 2, x: 540, y: 960, text: "Make this red", target });
    const out = await renderContext(projectId, ChatContext.parse({
      selection: { target, time: 2.4 },
      drawing: { imagePath: path, note: "move this up", hits: [target], time: 2.4 },
      commentIds: [comment.id],
    }));
    expect(out.text).toContain("Selected element (at 2.4 s)");
    expect(out.text).toContain('with the note: "move this up"');
    expect(out.text).toContain(path);
    expect(out.text).toContain('Comment 1 (at 2.0 s, pinned at x=540 y=960');
    expect(out.text).toContain("Make this red");
    expect(out.text).toMatch(/Find the marked element in the project files/);
    expect(out.images).toHaveLength(1);
    expect(await renderContext(projectId, ChatContext.parse({}))).toEqual({ text: "", images: [] });
  });
});

describe("the preview proxy's page rewrite", () => {
  const page = '<html><head><base href="/api/projects/p1/preview/"><script src="/api/runtime.js"></script></head><body><div id="root"></div></body></html>';

  it("points the page's two absolute URLs at the proxy and adds the pick script once, before </body>", () => {
    const out = rewritePreviewHtml(page, "/pv/TOKEN/p1");
    expect(out).toContain('<base href="/pv/TOKEN/p1/api/projects/p1/preview/">');
    expect(out).toContain('src="/pv/TOKEN/p1/api/runtime.js"');
    expect(out).not.toContain('"/api/');
    expect(out.match(/window\.__memotionPick = true/g)).toHaveLength(1);
    expect(out.indexOf("__memotionPick")).toBeLessThan(out.indexOf("</body>"));
  });

  it("still injects into a page with no closing body tag", () => {
    expect(rewritePreviewHtml("<div>x</div>", "/pv/T/p")).toContain("__memotionPick");
  });

  it("the injected script is valid JavaScript", () => {
    expect(() => new Function(PICK_SCRIPT)).not.toThrow();
  });
});

describe("marks in a chat request", () => {
  let llm: Server;
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  let projectId = "";

  beforeAll(async () => {
    llm = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`);
        res.end();
      });
    });
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
    const a = llm.address();
    const base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}/v1` : "";
    upsertProvider({ id: "markmock", name: "Mark Mock", baseURL: base, model: "m", capabilities: { tools: true, vision: true, images: false } });
    projectId = (await createProject({ name: "Marks chat", orientation: "landscape" })).id;
  }, 120_000);
  afterAll(() => llm.close());

  it("sends the marks text to the model, and the annotated frame as an image to a model that can see", async () => {
    const path = await saveMarkImage(projectId, PNG);
    const app = buildApp({ token: "t" });
    const res = await app.request(`/projects/${projectId}/chat`, {
      method: "POST",
      headers: { host: "127.0.0.1:1", authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ message: "Make this bigger", context: { selection: { target, time: 2.4 }, drawing: { imagePath: path, note: "", hits: [], time: 2.4 } } }),
    });
    await res.text();
    const sent = requests.at(-1)!.messages.filter((m) => m.role === "user");
    expect(String(sent[0]?.content)).toContain("Make this bigger");
    expect(String(sent[0]?.content)).toContain("Selected element (at 2.4 s)");
    expect(String(sent[0]?.content)).toContain("`#cta-title`");
    const second = sent[1]?.content;
    expect(Array.isArray(second) && second.some((p: { type: string }) => p.type === "image_url")).toBe(true);
  });

  it("rejects marks that point outside the marks folder before anything runs", async () => {
    const app = buildApp({ token: "t" });
    const before = requests.length;
    const res = await app.request(`/projects/${projectId}/chat`, {
      method: "POST",
      headers: { host: "127.0.0.1:1", authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ message: "x", context: { drawing: { imagePath: "../../../etc/passwd", note: "", hits: [], time: 0 } } }),
    });
    expect(res.status).toBe(400);
    expect(requests.length).toBe(before);
  });

  it("a plain message sends no marks block", async () => {
    for await (const _ of runAgent(projectId, "hello", new AbortController().signal)) void _;
    const last = requests.at(-1)!.messages.filter((m) => m.role === "user").at(-1);
    expect(String(last?.content)).not.toContain("marked the preview");
  });
});
