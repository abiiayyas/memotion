import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent, type AgentEvent } from "../src/agent/loop.js";
import { preferredModel } from "../src/audio/transcribe.js";
import { DEFAULT_PREFERENCES, getPreferences, resetPreferences, updatePreferences } from "../src/preferences.js";
import { gsapCacheFile } from "../src/projects/gsap.js";
import { createProject } from "../src/projects/store.js";
import { upsertProvider } from "../src/providers/store.js";
import { buildApp } from "../src/server.js";
import { listStorage, removeStorage, sizeOf } from "../src/storage.js";
import { localVoiceDir } from "../src/audio/localTts.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-prefs-"));
process.env.MEMOTION_DATA_DIR = dataDir;
process.env.MEMOTION_API_KEY_MOCK = "test-key";
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("preferences", () => {
  it("start as shipped, change one value at a time, and survive a restart", () => {
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
    updatePreferences({ maxSteps: 25 });
    updatePreferences({ replyLanguage: "id" });
    expect(getPreferences()).toEqual({ ...DEFAULT_PREFERENCES, maxSteps: 25, replyLanguage: "id" });
    expect(JSON.parse(readFileSync(join(dataDir, "preferences.json"), "utf8"))).toMatchObject({ maxSteps: 25, replyLanguage: "id" });
    expect(resetPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("fall back to the shipped values when the file holds something invalid", () => {
    writeFileSync(join(dataDir, "preferences.json"), JSON.stringify({ maxSteps: 9999, replyLanguage: "id" }));
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
    writeFileSync(join(dataDir, "preferences.json"), "not json");
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
    resetPreferences();
  });

  it("are refused over HTTP when a value is out of range or a key is unknown, and nothing is saved", async () => {
    const app = buildApp({ token: "t" });
    const put = (body: unknown) =>
      app.request("/preferences", { method: "PUT", headers: { Host: "127.0.0.1:1", Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await put({ maxSteps: 3 })).status).toBe(400);
    expect((await put({ maxImages: 1.5 })).status).toBe(400);
    expect((await put({ colour: "red" })).status).toBe(400);
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
    const ok = await put({ maxImages: 0, whisperModel: "base" });
    expect(await ok.json()).toMatchObject({ maxImages: 0, whisperModel: "base" });
    resetPreferences();
  });

  it("choose the speech model: automatic leaves it to the language, a pick gets its English-only variant for English", () => {
    expect(preferredModel("auto", "en")).toBeUndefined();
    expect(preferredModel("small", "id")).toBe("small");
    expect(preferredModel("small", undefined)).toBe("small");
    expect(preferredModel("medium", "en")).toBe("medium.en");
  });
});

type Delta = Record<string, unknown>;

/** An OpenAI-compatible endpoint that answers every request with one tool call, so the director never finishes by itself. */
function endlessToolCalls(): { server: Server; requests: { messages: { role: string; content: string }[] }[] } {
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      const delta: Delta = { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: "list_files", arguments: "{}" } }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return { server, requests };
}

describe("what the director reads from preferences", () => {
  const llm = endlessToolCalls();
  let projectId = "";

  beforeAll(async () => {
    const listening = Promise.withResolvers<void>();
    llm.server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const addr = llm.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("no port");
    upsertProvider({ id: "mock", name: "Mock", baseURL: `http://127.0.0.1:${addr.port}/v1`, model: "m" });
    projectId = (await createProject({ name: "Prefs", orientation: "landscape" })).id;
  }, 120_000);
  afterAll(() => llm.server.close());

  const run = async (): Promise<AgentEvent[]> => {
    llm.requests.length = 0;
    const events: AgentEvent[] = [];
    for await (const ev of runAgent(projectId, "go", new AbortController().signal)) events.push(ev);
    return events;
  };

  it("gives up after exactly the number of steps set, and says that number", async () => {
    updatePreferences({ maxSteps: 10 });
    const events = await run();
    expect(llm.requests).toHaveLength(10);
    expect(events.find((e) => e.type === "error")).toMatchObject({ message: expect.stringContaining("stopped after 10 steps") });
    resetPreferences();
  }, 60_000);

  it("tells the director which language to reply in, only when one is chosen", async () => {
    updatePreferences({ maxSteps: 10 });
    await run();
    expect(llm.requests[0]?.messages[0]?.content).not.toContain("# Reply language");
    updatePreferences({ replyLanguage: "id" });
    await run();
    expect(llm.requests[0]?.messages[0]?.content).toMatch(/# Reply language\nWrite your messages and your final summary to the user in Indonesian\./);
    resetPreferences();
  }, 60_000);
});

describe("storage", () => {
  it("counts a link as itself and never as what it points at", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memotion-size-"));
    const outside = mkdtempSync(join(tmpdir(), "memotion-outside-"));
    try {
      writeFileSync(join(outside, "big.bin"), Buffer.alloc(200_000));
      writeFileSync(join(dir, "small.txt"), "12345");
      symlinkSync(outside, join(dir, "link"));
      expect(await sizeOf(dir)).toBeLessThan(10_000);
      expect(await sizeOf(join(dir, "missing"))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("lists what is on disk with sizes and removes exactly the named item", async () => {
    mkdirSync(join(dataDir, "vendor"), { recursive: true });
    writeFileSync(gsapCacheFile(), Buffer.alloc(1234));
    mkdirSync(localVoiceDir("piper-en_US-lessac"), { recursive: true });
    writeFileSync(join(localVoiceDir("piper-en_US-lessac"), "voice.onnx"), Buffer.alloc(5000));

    const before = await listStorage();
    expect(before.items.find((i) => i.id === "gsap")?.bytes).toBe(1234);
    expect(before.items.find((i) => i.id === "voice:piper-en_US-lessac")?.bytes).toBe(5000);
    expect(before.items.find((i) => i.id === "voice:piper-id_ID-news_tts")).toBeUndefined();

    expect(await removeStorage("gsap")).toBe(true);
    expect(existsSync(gsapCacheFile())).toBe(false);
    expect(existsSync(localVoiceDir("piper-en_US-lessac"))).toBe(true);
    expect((await listStorage()).items.some((i) => i.id === "gsap")).toBe(false);
  });

  it("refuses anything that is not a listed item, including path tricks", async () => {
    const victim = join(dataDir, "victim.txt");
    writeFileSync(victim, "keep");
    for (const id of ["", "../victim.txt", "voice:../../victim.txt", "whisper-model:../../../victim", "voice:piper-id_ID-news_tts", victim]) {
      expect(await removeStorage(id)).toBe(false);
    }
    expect(readFileSync(victim, "utf8")).toBe("keep");
  });
});
