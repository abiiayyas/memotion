import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { systemFromDoctor } from "../src/engine/system.js";

describe("the system check", () => {
  const report = (checks: { name: string; ok: boolean; detail?: string }[]) => ({ ok: checks.every((c) => c.ok), checks });

  it("reports ffmpeg, ffprobe and Chrome with a way forward only for what is missing", () => {
    const out = systemFromDoctor(report([
      { name: "FFmpeg", ok: false, detail: "Not found" },
      { name: "FFprobe", ok: true, detail: "ffprobe 8.1 at /usr/local/bin/ffprobe" },
      { name: "Chrome", ok: false, detail: "Not found" },
      { name: "Docker running", ok: false, detail: "Not running" }, // optional: not our business
    ]));
    expect(out.map((c) => c.name)).toEqual(["FFmpeg", "FFprobe", "Chrome"]);
    expect(out.map((c) => c.ok)).toEqual([false, true, false]);
    expect(out[0]?.fix).toMatch(/brew install ffmpeg/);
    expect(out[0]?.fix).toMatch(/does not install it for you/);
    expect(out[1]?.fix).toBeUndefined();
    expect(out[2]?.fix).toMatch(/download/i);
  });

  it("counts a check the report does not contain, and a report that is not a report, as missing rather than fine", () => {
    expect(systemFromDoctor(report([{ name: "FFmpeg", ok: true, detail: "x" }])).map((c) => c.ok)).toEqual([true, false, false]);
    expect(systemFromDoctor(null).every((c) => !c.ok)).toBe(true);
    expect(systemFromDoctor({ checks: "nope" }).every((c) => !c.ok)).toBe(true);
  });

  it("understands the shape of a real doctor report (captured from hyperframes 0.8.168)", () => {
    const real = JSON.parse(readFileSync(new URL("./fixtures/doctor.json", import.meta.url), "utf8"));
    const out = systemFromDoctor(real);
    expect(out.every((c) => c.ok)).toBe(true);
    expect(out[0]?.detail).toMatch(/^ffmpeg \d/);
  });
});
