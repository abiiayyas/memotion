import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensureGsapCache, GSAP_VERSION, localizeGsap, localizeHtml } from "../src/projects/gsap.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-gsap-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("which script tags are pointed at the local copy", () => {
  const local = "assets/vendor/gsap.min.js";
  it("rewrites GSAP core from the CDN, any 3.x spelling, and nothing else", () => {
    for (const url of [
      "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
      "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js",
      "https://cdn.jsdelivr.net/npm/gsap@3.12/dist/gsap.min.js",
      "https://unpkg.com/gsap@3.13.0/dist/gsap.min.js",
    ]) {
      expect(localizeHtml(`<script src="${url}"></script>`)).toBe(`<script src="${local}"></script>`);
    }
    const keep = [
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/ScrollTrigger.min.js"></script>', // a plugin, a different file
      '<script src="https://cdn.jsdelivr.net/npm/gsap@2.1.3/dist/TweenMax.min.js"></script>', // another major version
      '<script src="https://example.com/gsap@3/dist/gsap.min.js"></script>', // not a host we know
      '<script src="assets/vendor/gsap.min.js"></script>',
    ];
    for (const k of keep) expect(localizeHtml(k)).toBe(k);
  });

  it("is idempotent and rewrites every occurrence", () => {
    const html = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>';
    const once = localizeHtml(html);
    expect(once.match(/assets\/vendor\/gsap\.min\.js/g)).toHaveLength(2);
    expect(localizeHtml(once)).toBe(once);
  });
});

describe("with no verified copy of GSAP (offline, or a tampered cache)", () => {
  it("leaves the project alone, and never trusts a cache file whose bytes are not the pinned ones", async () => {
    const { id } = await createProject({ name: "Offline", orientation: "landscape" });
    const index = join(projectPath(id), "index.html");
    const before = readFileSync(index, "utf8");
    expect(before).toMatch(/cdn\.jsdelivr\.net\/npm\/gsap@/);

    // A planted file named like the cache is not accepted: it fails the checksum and is discarded.
    const cache = join(dataDir, "vendor", `gsap-${GSAP_VERSION}.min.js`);
    mkdirSync(join(dataDir, "vendor"), { recursive: true });
    writeFileSync(cache, "alert('not gsap')");
    // Without network the replacement download fails, so there is no copy and nothing is rewritten.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    try {
      expect(await ensureGsapCache()).toBeNull();
      expect(existsSync(cache)).toBe(false);
      expect(await localizeGsap(id)).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(readFileSync(index, "utf8")).toBe(before);
    expect(existsSync(join(projectPath(id), "assets", "vendor"))).toBe(false);
  });
});

// Downloads GSAP (72 KB) once and checks the whole path with real files. Opt in with MEMOTION_LIVE_TESTS=1.
describe.skipIf(!process.env.MEMOTION_LIVE_TESTS)("with the real GSAP", () => {
  it("copies it into the project, rewrites index and scenes, and a second run changes nothing", async () => {
    delete process.env.MEMOTION_NO_VENDOR_DOWNLOAD; // this one needs the real download
    const { id } = await createProject({ name: "Local gsap", orientation: "landscape" });
    const root = projectPath(id);
    mkdirSync(join(root, "compositions"), { recursive: true });
    writeFileSync(join(root, "compositions", "scene.html"), '<div><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></div>');

    const changed = await localizeGsap(id);
    expect(changed.sort()).toEqual(["compositions/scene.html", "index.html"]);
    expect(readFileSync(join(root, "index.html"), "utf8")).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(readFileSync(join(root, "index.html"), "utf8")).toContain('src="assets/vendor/gsap.min.js"');
    expect(readFileSync(join(root, "assets", "vendor", "gsap.min.js"), "utf8")).toContain(`GSAP ${GSAP_VERSION}`);
    expect(await localizeGsap(id)).toEqual([]);
  }, 120_000);
});
