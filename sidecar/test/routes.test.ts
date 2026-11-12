import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { claimProject } from "../src/agent/loop.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-routes-"));
process.env.MEMOTION_DATA_DIR = dataDir;
const scratch = mkdtempSync(join(tmpdir(), "memotion-routes-src-"));
afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const TOKEN = "t0k3n";
const app = buildApp({ token: TOKEN });
const HOST = { Host: "127.0.0.1:1" };
const authed = { ...HOST, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = authed) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const KIT = {
  id: "demo",
  name: "Demo",
  colors: { primary: "#112233", accent: "#ff7a3d", background: "#0b0b0f", text: "#f5f5f5" },
  fonts: { heading: "Poppins", body: "Inter" },
  notes: "",
  captionStyle: "highlight",
};

describe("auth", () => {
  it("refuses every new route without the token", async () => {
    for (const [m, p] of [["GET", "/brand-kits"], ["GET", "/templates"], ["GET", "/formats"], ["GET", "/settings"], ["POST", "/projects/x/capture"]] as const) {
      expect((await call(m, p, undefined, HOST)).status, p).toBe(401);
    }
  });
});

describe("brand kits over HTTP", () => {
  beforeAll(() => {
    writeFileSync(join(scratch, "logo.png"), PNG);
    writeFileSync(join(scratch, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  });

  it("creates, lists and validates", async () => {
    expect((await call("PUT", "/brand-kits/demo", KIT)).status).toBe(200);
    expect((await call("PUT", "/brand-kits/other", KIT)).status).toBe(400); // id must match the path
    expect((await call("PUT", "/brand-kits/demo", { ...KIT, colors: { ...KIT.colors, accent: "red" } })).status).toBe(400);
    const list = (await (await call("GET", "/brand-kits")).json()) as { id: string }[];
    expect(list.map((k) => k.id)).toEqual(["demo"]);
  });

  it("serves the logo to an <img> by query token only on the raw path, and sandboxes SVG", async () => {
    await call("POST", "/brand-kits/demo/logo", { path: join(scratch, "logo.png") });
    const ok = await app.request(`/brand-kits/demo/raw/logo?token=${TOKEN}`, { headers: HOST });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    // The query token is not accepted on ordinary routes.
    expect((await app.request(`/brand-kits?token=${TOKEN}`, { headers: HOST })).status).toBe(401);

    await call("POST", "/brand-kits/demo/logo", { path: join(scratch, "logo.svg") });
    const svg = await app.request(`/brand-kits/demo/raw/logo?token=${TOKEN}`, { headers: HOST });
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("builds a starting kit from a website's colours and fonts", async () => {
    const res = await call("POST", "/brand-kits/from-site", { name: "Site Kit", colors: ["#0b0b0f", "#f5f5f5", "#ff7a3d", "#2a6df4"], fonts: ["system-ui", "Lato"] });
    const kit = (await res.json()) as { id: string; colors: { background: string }; fonts: { heading: string } };
    expect(kit.id).toMatch(/^site-kit-[0-9a-f]{4}$/);
    expect(kit.colors.background).toBe("#0b0b0f");
    expect(kit.fonts.heading).toBe("Lato");
  });

  it("applies a kit to a project and clears it again", async () => {
    const { id } = await createProject({ name: "Brand route", orientation: "landscape" });
    expect((await call("POST", `/projects/${id}/brand`, { kitId: "demo" })).status).toBe(200);
    expect(((await (await call("GET", `/projects/${id}`)).json()) as { brandKitId?: string }).brandKitId).toBe("demo");
    expect((await call("POST", `/projects/${id}/brand`, { kitId: null })).status).toBe(200);
    expect(((await (await call("GET", `/projects/${id}`)).json()) as { brandKitId?: string }).brandKitId).toBeUndefined();
  }, 60_000);
});

describe("formats over HTTP", () => {
  it("lists the built-ins and rejects an unknown one", async () => {
    const list = (await (await call("GET", "/formats")).json()) as { id: string }[];
    expect(list.map((f) => f.id)).toEqual(expect.arrayContaining(["course-module", "short-hook", "product-promo"]));
    const { id } = await createProject({ name: "Format route", orientation: "portrait" });
    expect((await call("PUT", `/projects/${id}/format`, { formatId: "short-hook" })).status).toBe(200);
    expect((await call("PUT", `/projects/${id}/format`, { formatId: "nope" })).status).toBe(400);
    expect(((await (await call("GET", `/projects/${id}`)).json()) as { formatId?: string }).formatId).toBe("short-hook");
  }, 60_000);
});

describe("catalog picks over HTTP", () => {
  it("lists the shelves, saves picks, refuses an unknown shelf or item, and clears them", async () => {
    const shelves: { shelf: string; items: { id: string; body?: string }[] }[] = await (await call("GET", "/catalog")).json();
    expect(shelves.map((s) => s.shelf)).toEqual(["visual", "edit", "hook", "framework", "structure", "preset", "effects", "captions"]);
    expect(shelves.find((s) => s.shelf === "hook")?.items.map((i) => i.id)).toContain("fake-ui");
    expect(shelves.flatMap((s) => s.items).every((i) => i.body === undefined)).toBe(true);

    const { id } = await createProject({ name: "Picks route", orientation: "portrait" });
    const picksOf = async () => {
      const project: { picks?: Record<string, string> } = await (await call("GET", `/projects/${id}`)).json();
      return project.picks;
    };
    expect((await call("PUT", `/projects/${id}/picks`, { hook: "fake-ui", visual: "comic-ink" })).status).toBe(200);
    expect(await picksOf()).toEqual({ hook: "fake-ui", visual: "comic-ink" });
    expect((await call("PUT", `/projects/${id}/picks`, { hook: "nope" })).status).toBe(400);
    expect((await call("PUT", `/projects/${id}/picks`, { nonsense: "x" })).status).toBe(400);
    expect(await picksOf()).toEqual({ hook: "fake-ui", visual: "comic-ink" });
    expect((await call("PUT", `/projects/${id}/picks`, {})).status).toBe(200);
    expect(await picksOf()).toBeUndefined();
  }, 60_000);
});

describe("cost and network gates", () => {
  it("keeps image generation off by default and explains why it cannot run", async () => {
    const s = (await (await call("GET", "/settings")).json()) as { imageGeneration: boolean; imageBlocker: string | null };
    expect(s.imageGeneration).toBe(false);
    expect(s.imageBlocker).toMatch(/switched off/);
    const { id } = await createProject({ name: "Image route", orientation: "landscape" });
    const res = await call("POST", `/projects/${id}/images`, { prompt: "a red bicycle" });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/switched off/);
    const on = (await (await call("PUT", "/settings/image-generation", { enabled: true })).json()) as { imageGeneration: boolean; imageBlocker: string };
    expect(on.imageGeneration).toBe(true);
    expect(on.imageBlocker).toMatch(/No provider has an image model/);
    await call("PUT", "/settings/image-generation", { enabled: false });
  }, 60_000);

  it("refuses to capture a private address", async () => {
    const { id } = await createProject({ name: "Capture route", orientation: "landscape" });
    for (const url of ["http://127.0.0.1:47891/projects", "http://169.254.169.254/", "file:///etc/passwd"]) {
      const res = await call("POST", `/projects/${id}/capture`, { url });
      expect(res.status, url).toBe(500);
    }
  }, 60_000);
});

describe("templates and imports over HTTP", () => {
  it("makes a project from a template and imports a HyperFrames folder", async () => {
    const src = (await createProject({ name: "Tpl source", orientation: "portrait" })).id;
    writeFileSync(
      join(projectPath(src), "index.html"),
      `<html data-composition-variables='[{"id":"h","type":"string","label":"H","default":"One"}]'><body><div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1080" data-height="1920"><h1 id="t" class="clip" data-start="0" data-duration="4" data-track-index="0" data-var-text="h">One</h1></div><script>window.__timelines["main"]=gsap.timeline({paused:true})</script></body></html>`,
    );
    const saved = (await (await call("POST", `/projects/${src}/save-template`, { name: "Tpl", description: "d" })).json()) as { id: string };
    const vars = (await (await call("GET", `/templates/${saved.id}/variables`)).json()) as { variables: { id: string }[] }[];
    expect(vars[0]?.variables[0]?.id).toBe("h");
    const made = (await (await call("POST", "/projects/from-template", { templateId: saved.id, name: "From tpl", fills: [{ file: "index.html", id: "h", value: "Two" }] })).json()) as { id: string; orientation: string };
    expect(made.orientation).toBe("portrait");
    expect((await call("GET", "/templates")).status).toBe(200);
    expect((await call("DELETE", `/templates/${saved.id}`)).status).toBe(200);
    expect(((await (await call("GET", "/templates")).json()) as unknown[]).length).toBe(0);

    const folder = join(scratch, "hf");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "index.html"), '<div data-composition-id="main" data-width="1920" data-height="1080"></div>');
    const imported = await call("POST", "/projects/import/hyperframes", { path: folder, name: "Imported" });
    expect(imported.status).toBe(200);
    expect((await call("POST", "/projects/import/hyperframes", { path: scratch })).status).toBe(500);
  }, 240_000);
});

describe("deleting a project", () => {
  it("removes the project's folder and answers ok; a second delete of the same id is still ok (nothing left to remove)", async () => {
    const { id } = await createProject({ name: "To delete", orientation: "landscape" });
    expect(existsSync(projectPath(id))).toBe(true);
    const res = await call("DELETE", `/projects/${id}`);
    expect(res.status).toBe(200);
    expect(existsSync(projectPath(id))).toBe(false);
    expect((await call("DELETE", `/projects/${id}`)).status).toBe(200);
  });

  it("refuses while the director is working on it, and the files stay", async () => {
    const { id } = await createProject({ name: "Busy", orientation: "landscape" });
    const release = claimProject(id);
    expect(release).not.toBeNull();
    const res = await call("DELETE", `/projects/${id}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/director is working/);
    expect(existsSync(projectPath(id))).toBe(true);
    release?.();
    expect((await call("DELETE", `/projects/${id}`)).status).toBe(200);
    expect(existsSync(projectPath(id))).toBe(false);
  });

  it("needs the token like every other route", async () => {
    const { id } = await createProject({ name: "Guarded", orientation: "landscape" });
    expect((await call("DELETE", `/projects/${id}`, undefined, HOST)).status).toBe(401);
    expect(existsSync(projectPath(id))).toBe(true);
  });
});
