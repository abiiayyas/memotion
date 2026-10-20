import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePreview, stopAllPreviews, withFreshPreview } from "../src/engine/preview.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-prev-"));
process.env.MEMOTION_DATA_DIR = dataDir;

describe("preview freshness after a write", () => {
  let id: string;
  let url: string;

  beforeAll(async () => {
    id = (await createProject({ name: "Preview race", orientation: "landscape" })).id;
    url = (await ensurePreview(id)).url;
  }, 120_000);

  afterAll(() => {
    stopAllPreviews();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // Measured without the wait: a request issued right after a write got the previous composition roughly
  // one time in four, and a preview reloaded in that window stayed stale. Twelve rounds make a regression
  // all but certain to show (0.75^12 is about 3% to pass by luck).
  it("never serves the previous composition once withFreshPreview returns", async () => {
    const file = join(projectPath(id), "index.html");
    const base = readFileSync(file, "utf8");
    for (let i = 0; i < 12; i++) {
      const mark = `Mark${i}x${Math.random().toString(36).slice(2, 7)}`;
      await withFreshPreview(id, async () => {
        writeFileSync(file, base.replace(">Title<", `>${mark}<`));
      });
      const html = await fetch(url).then((r) => r.text());
      expect(html, `round ${i}`).toContain(mark);
    }
  }, 120_000);

  it("gives up after the timeout when the edit does not change the composition", async () => {
    const t0 = Date.now();
    await withFreshPreview(id, async () => {
      // nothing written
    });
    // No change means no ETag change; the wait must end by itself rather than hang the request.
    expect(Date.now() - t0).toBeLessThan(2500);
  }, 30_000);
});
