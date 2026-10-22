import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_REVIEWS_PER_TURN, pickTimes, REVIEWER_SYSTEM } from "../src/agent/review.js";
import { runTool } from "../src/agent/tools.js";
import { hyperframesBin } from "../src/config.js";
import { createProject } from "../src/projects/store.js";
import { getReviewerProvider, setReviewerProviderId, upsertProvider } from "../src/providers/store.js";
import { buildApp } from "../src/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-review-"));
process.env.MEMOTION_DATA_DIR = dataDir;
process.env.MEMOTION_API_KEY_SEER = "sk-test";
process.env.MEMOTION_API_KEY_BLIND = "sk-test";
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

function hasChrome(): boolean {
  try {
    const out = execFileSync(process.execPath, [hyperframesBin(), "browser", "path"], { encoding: "utf8", timeout: 20_000 }).trim().split("\n").at(-1) ?? "";
    return existsSync(out);
  } catch {
    return false;
  }
}

describe("which frames are looked at", () => {
  it("takes one shortly after each scene starts, so a scene that never appears is caught", () => {
    expect(pickTimes(15, [0, 3, 6, 9, 12])).toEqual([0.8, 3.8, 6.8, 9.8, 12.8]);
  });

  it("stays inside the video, drops repeats, and spreads out when there are too many scenes", () => {
    expect(pickTimes(2, [0, 1.9])).toEqual([0.8, 1.9]);
    expect(pickTimes(10, [0, 0, 0.05])).toEqual([0.8]);
    const many = pickTimes(100, Array.from({ length: 30 }, (_, i) => i * 3));
    expect(many).toHaveLength(6);
    expect(many[0]).toBe(0.8);
    expect(many.at(-1)).toBe(87.8);
  });

  it("falls back to even samples when the timeline has no clips", () => {
    expect(pickTimes(10, [])).toEqual([1.5, 4, 6.5, 9]);
  });
});

describe("the reviewer setting", () => {
  it("accepts only a provider that is marked as able to see, and forgets one that went away", () => {
    upsertProvider({ id: "blind", name: "Blind", baseURL: "http://127.0.0.1:1/v1", model: "m", capabilities: { tools: true, vision: false, images: false } });
    upsertProvider({ id: "seer", name: "Seer", baseURL: "http://127.0.0.1:1/v1", model: "m", capabilities: { tools: true, vision: true, images: false } });
    expect(() => setReviewerProviderId("blind")).toThrow(/not marked as able to see/);
    expect(() => setReviewerProviderId("nope")).toThrow(/Unknown provider/);
    setReviewerProviderId("seer");
    expect(getReviewerProvider()?.id).toBe("seer");
    // Turning "Can see images" off later must switch the reviewer off, not leave a blind one in charge.
    upsertProvider({ id: "seer", name: "Seer", baseURL: "http://127.0.0.1:1/v1", model: "m", capabilities: { tools: true, vision: false, images: false } });
    expect(getReviewerProvider()).toBeUndefined();
    setReviewerProviderId(null);
  });

  it("is offered through the settings routes, with only the providers that can see as choices", async () => {
    upsertProvider({ id: "seer", name: "Seer", baseURL: "http://127.0.0.1:1/v1", model: "m", capabilities: { tools: true, vision: true, images: false } });
    const app = buildApp({ token: "t" });
    const h = { host: "127.0.0.1:1", authorization: "Bearer t", "content-type": "application/json" };
    const put = await app.request("/settings/reviewer", { method: "PUT", headers: h, body: JSON.stringify({ providerId: "seer" }) });
    const body = await put.json();
    expect(body).toMatchObject({ reviewerProviderId: "seer", reviewerWorking: true });
    expect(body.reviewerChoices.map((c: { id: string }) => c.id)).toEqual(["seer"]);
    const refused = await app.request("/settings/reviewer", { method: "PUT", headers: h, body: JSON.stringify({ providerId: "blind" }) });
    expect(refused.status).toBe(400);
    setReviewerProviderId(null);
  });
});

describe.skipIf(!hasChrome())("the review tool, with frames from the real renderer", () => {
  let server: Server;
  const seen: { messages: { role: string; content: unknown }[]; model: string }[] = [];
  let reply = "No visible problems.";
  let projectId = "";
  const ctx = (budget = MAX_REVIEWS_PER_TURN) => ({ signal: new AbortController().signal, vision: false, imageBudget: { left: 0 }, reviewBudget: { left: budget } });

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        seen.push(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    const base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}/v1` : "";
    upsertProvider({ id: "seer", name: "Seer", baseURL: base, model: "vision-1", capabilities: { tools: true, vision: true, images: false } });
    projectId = (await createProject({ name: "Review", orientation: "portrait" })).id;
  }, 120_000);
  afterAll(() => {
    server.close();
    setReviewerProviderId(null);
  });

  it("says plainly that nothing was reviewed when no reviewer is set up, and calls no model", async () => {
    setReviewerProviderId(null);
    const out = await runTool(projectId, "review", {}, ctx());
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/No reviewer is set up/);
    expect(seen).toHaveLength(0);
  });

  it("sends the reviewer the rules, the video's shape and labelled frames as images, and passes its answer on", async () => {
    setReviewerProviderId("seer");
    reply = "3.8 s: the headline is cut off at the right edge.";
    const out = await runTool(projectId, "review", { times: [0.5, 2], focus: "the headline" }, ctx());
    expect(out.ok).toBe(true);
    expect(out.summary).toBe("problems reported");
    expect(out.content).toContain("the headline is cut off at the right edge");
    expect(out.content).toMatch(/can be wrong/);

    const req = seen.at(-1)!;
    expect(req.model).toBe("vision-1");
    expect(req.messages[0]).toEqual({ role: "system", content: REVIEWER_SYSTEM });
    const parts = req.messages[1]!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]?.text).toMatch(/1080×1920 \(portrait\)/);
    expect(parts[0]?.text).toContain("the headline");
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
    expect(parts.filter((p) => p.type === "image_url").every((p) => p.image_url?.url.startsWith("data:image/png;base64,"))).toBe(true);
    expect(parts.filter((p) => p.type === "text").map((p) => p.text)).toEqual(expect.arrayContaining(["Frame 1 at 0.5 s:", "Frame 2 at 2.0 s:"]));
  }, 120_000);

  it("reports a clean review as clean, and stops after the per-request limit", async () => {
    reply = "No visible problems.";
    const budget = ctx(2);
    expect((await runTool(projectId, "review", { times: [1] }, budget)).summary).toBe("no visible problems");
    await runTool(projectId, "review", { times: [1] }, budget);
    const before = seen.length;
    const third = await runTool(projectId, "review", { times: [1] }, budget);
    expect(third.ok).toBe(false);
    expect(third.content).toMatch(/limit/i);
    expect(seen.length).toBe(before);
  }, 180_000);
});
