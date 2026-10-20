import { describe, expect, it } from "vitest";
import { parseJsonTail } from "../src/engine/tools.js";
import { parseProgress } from "../src/engine/render.js";
import { safeJoin } from "../src/projects/store.js";

describe("safeJoin", () => {
  it("allows paths inside the root and rejects escapes", () => {
    expect(safeJoin("/p/a", "assets/x.png")).toBe("/p/a/assets/x.png");
    expect(() => safeJoin("/p/a", "../b/x")).toThrow(/escapes/);
    expect(() => safeJoin("/p/a", "/etc/passwd")).toThrow(/escapes/);
    // A sibling directory sharing the root's prefix must not pass a naive startsWith check.
    expect(() => safeJoin("/p/a", "../ab/x")).toThrow(/escapes/);
  });
});

describe("parseJsonTail", () => {
  it("skips [INFO] log lines the CLI prints before the JSON object", () => {
    const out = '[INFO] [Compiler] fetched fonts\n{\n  "ok": true,\n  "lint": {"findings": []}\n}\n';
    expect(parseJsonTail(out)).toEqual({ ok: true, lint: { findings: [] } });
  });
  it("reads a compact one-line object (what `transcribe --json` prints), after log lines", () => {
    const out = '[INFO] something\n{"ok":true,"format":"srt","wordCount":2,"transcriptPath":"/tmp/t.json"}\n';
    expect(parseJsonTail(out)).toEqual({ ok: true, format: "srt", wordCount: 2, transcriptPath: "/tmp/t.json" });
  });
  it("takes the last compact object and ignores progress lines that merely start with a brace", () => {
    const out = '{"ok":false}\n{not json}\n{"ok":true,"n":2}\n';
    expect(parseJsonTail(out)).toEqual({ ok: true, n: 2 });
  });
  it("returns null when no JSON object is present", () => {
    expect(parseJsonTail("[INFO] nothing here")).toBeNull();
  });
});

describe("parseProgress", () => {
  it("reads @hf-progress lines and ignores everything else", () => {
    expect(parseProgress('@hf-progress {"code":"capture","done":3,"total":300,"pct":27}')).toEqual({ code: "capture", pct: 27 });
    expect(parseProgress("  ██████ 27%  Capturing")).toBeNull();
    expect(parseProgress("@hf-progress {broken")).toBeNull();
  });
});
