import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_LOCAL_VOICE,
  downloadVerified,
  enginePackage,
  findFfmpeg,
  installLocalTts,
  LOCAL_VOICES,
  LocalTtsNotInstalled,
  localTtsStatus,
  synthesizeLocal,
  wavToMp3,
} from "../src/audio/localTts.js";
import { generateSpeechAndCaptions } from "../src/audio/index.js";
import { createProject, projectPath } from "../src/projects/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-local-tts-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("verified download", () => {
  const body = Buffer.from("pretend this is a voice archive");
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Length": body.length });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    base = typeof a === "object" && a ? `http://127.0.0.1:${a.port}/f` : "";
  });
  afterAll(() => server.close());

  it("keeps a file whose checksum matches", async () => {
    const dest = join(dataDir, "ok.bin");
    await downloadVerified(base, dest, { sha256: sha256(body) }, 1000);
    expect(readFileSync(dest)).toEqual(body);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("discards a file whose checksum does not match, leaving nothing behind", async () => {
    const dest = join(dataDir, "bad.bin");
    await expect(downloadVerified(base, dest, { sha256: "0".repeat(64) }, 1000)).rejects.toThrow(/checksum/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("verifies npm-style sha512 integrity", async () => {
    const good = `sha512-${createHash("sha512").update(body).digest("base64")}`;
    await downloadVerified(base, join(dataDir, "npm.bin"), { integrity: good }, 1000);
    await expect(downloadVerified(base, join(dataDir, "npm2.bin"), { integrity: "sha512-AAAA" }, 1000)).rejects.toThrow(/checksum/);
  });

  it("refuses a download larger than the cap", async () => {
    await expect(downloadVerified(base, join(dataDir, "big.bin"), {}, 10)).rejects.toThrow(/larger than expected/);
    expect(existsSync(join(dataDir, "big.bin"))).toBe(false);
  });
});

describe("offline voice, before anything is downloaded", () => {
  it("reports nothing installed and refuses to speak, asking for consent instead of downloading", async () => {
    const status = localTtsStatus();
    expect(status.engine).toBe(false);
    expect(Object.values(status.voices).every((v) => v === false)).toBe(true);
    await expect(synthesizeLocal("Halo", DEFAULT_LOCAL_VOICE, 1, join(dataDir, "x.wav"))).rejects.toBeInstanceOf(LocalTtsNotInstalled);
    expect(existsSync(join(dataDir, "local-tts"))).toBe(false);
  });

  it("surfaces the refusal through speech generation for a project", async () => {
    const { id } = await createProject({ name: "Local voice", orientation: "landscape" });
    await expect(generateSpeechAndCaptions(id, { text: "Halo dunia", provider: "local", rate: 1 })).rejects.toBeInstanceOf(LocalTtsNotInstalled);
    expect(existsSync(join(projectPath(id), "assets", "audio", "voiceover.mp3"))).toBe(false);
  });

  it("knows which platforms have an engine and pins every voice by checksum", () => {
    expect(enginePackage("darwin", "x64")).toBe("sherpa-onnx-darwin-x64");
    expect(enginePackage("freebsd", "x64")).toBeNull();
    for (const v of Object.values(LOCAL_VOICES)) expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an unknown voice before touching the network or disk", async () => {
    await expect(installLocalTts("nope")).rejects.toThrow(/Unknown offline voice/);
  });
});

// Downloads ~60 MB (engine + voice) and runs real synthesis. Opt in with MEMOTION_LIVE_TESTS=1.
describe.skipIf(!process.env.MEMOTION_LIVE_TESTS || !enginePackage() || !findFfmpeg())("offline voice, real", () => {
  it("installs, speaks Indonesian, and gives word times that cover the speech", async () => {
    await installLocalTts(DEFAULT_LOCAL_VOICE);
    expect(localTtsStatus().engine).toBe(true);
    expect(localTtsStatus().voices[DEFAULT_LOCAL_VOICE]).toBe(true);

    const text = "Selamat datang di kursus membuat video motion. Hari ini kita belajar membuat caption.";
    const wav = join(dataDir, "real.wav");
    const res = await synthesizeLocal(text, DEFAULT_LOCAL_VOICE, 1, wav);
    expect(res.duration).toBeGreaterThan(4);
    expect(res.duration).toBeLessThan(12);
    expect(res.words.map((w) => w.text)).toEqual(text.split(" "));
    for (let i = 1; i < res.words.length; i++) expect(res.words[i]!.start).toBeGreaterThanOrEqual(res.words[i - 1]!.end - 1e-9);
    expect(res.words.at(-1)!.end).toBeLessThanOrEqual(res.duration + 0.01);

    // A faster rate must give a shorter recording.
    const fast = await synthesizeLocal(text, DEFAULT_LOCAL_VOICE, 1.5, join(dataDir, "fast.wav"));
    expect(fast.duration).toBeLessThan(res.duration * 0.85);

    const mp3 = join(dataDir, "real.mp3");
    await wavToMp3(wav, mp3);
    const probed = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3], { encoding: "utf8" });
    expect(Math.abs(Number(probed) - res.duration)).toBeLessThan(0.2);
  }, 600_000);

  it("generates a project voiceover and captions through the normal path", async () => {
    const { id } = await createProject({ name: "Offline voiceover", orientation: "landscape" });
    const out = await generateSpeechAndCaptions(
      id,
      { text: "Halo semuanya. Ini suara yang dibuat tanpa internet.", provider: "local", rate: 1 },
      { style: "highlight", position: "bottom", fontSize: 64, fontFamily: "Inter", primaryColor: "#ffffff", accentColor: "#ff9d6b", wordsPerGroup: 3 },
    );
    expect(existsSync(join(projectPath(id), out.audioPath))).toBe(true);
    expect(existsSync(join(projectPath(id), "compositions", "captions.html"))).toBe(true);
    expect(out.words.length).toBe(8);
  }, 300_000);
});
