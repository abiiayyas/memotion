import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, luminance, normalizeHex, pickFonts, pickPalette, saturation } from "../src/brand/palette.js";
import { BUNDLED_FONTS, brandBrief, type BrandKit } from "../src/brand/store.js";

describe("normalizeHex", () => {
  it("expands short forms, drops alpha, lowercases, and rejects the rest", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#FF7A3DCC")).toBe("#ff7a3d");
    expect(normalizeHex(" #112233 ")).toBe("#112233");
    for (const bad of ["red", "rgb(1,2,3)", "#12", "#12345", "112233"]) expect(normalizeHex(bad), bad).toBeNull();
  });
});

describe("luminance and saturation", () => {
  it("order black < grey < white and grey < a vivid colour", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#808080")).toBeGreaterThan(luminance("#202020"));
    expect(saturation("#808080")).toBe(0);
    expect(saturation("#ff0000")).toBe(1);
  });
});

describe("pickPalette", () => {
  it("gives the colourful colours to primary and accent, and the extremes to background and text", () => {
    const p = pickPalette(["#0b0b0f", "#f5f5f5", "#ff7a3d", "#2a6df4", "#888888"]);
    expect(p.background).toBe("#0b0b0f");
    expect(p.text).toBe("#f5f5f5");
    expect([p.primary, p.accent].sort()).toEqual(["#2a6df4", "#ff7a3d"]);
  });

  it("keeps a dark background and readable text on a light site (white and black only)", () => {
    const p = pickPalette(["#ffffff", "#000000"]);
    expect(luminance(p.background)).toBeLessThan(0.2);
    expect(luminance(p.text)).toBeGreaterThan(0.6);
  });

  it("falls back to the defaults for no colours, and ignores values that are not hex", () => {
    expect(pickPalette([])).toEqual(DEFAULT_PALETTE);
    expect(pickPalette(["red", "rgb(0,0,0)"])).toEqual(DEFAULT_PALETTE);
  });

  it("reuses the only colourful colour for both roles instead of inventing one", () => {
    const p = pickPalette(["#1e90ff"]);
    expect(p.primary).toBe("#1e90ff");
    expect(p.accent).toBe("#1e90ff");
  });
});

describe("pickFonts", () => {
  it("skips system fallbacks and unsafe names, and defaults when nothing usable is left", () => {
    expect(pickFonts(["system-ui", "Playfair Display", "Source Sans 3"])).toEqual({ heading: "Playfair Display", body: "Source Sans 3" });
    expect(pickFonts(["sans-serif", "A}</style>"])).toEqual({ heading: "Poppins", body: "Inter" });
    expect(pickFonts(["Lato"])).toEqual({ heading: "Lato", body: "Lato" });
  });
});

describe("brandBrief font rule", () => {
  const kit: BrandKit = {
    id: "k", name: "K", notes: "", captionStyle: "highlight", customFonts: [],
    colors: { primary: "#111111", accent: "#222222", background: "#000000", text: "#ffffff" },
    fonts: { heading: "Fraunces", body: "Inter" },
  };

  it("tells the director to substitute a font that is neither bundled nor supplied as a file", () => {
    expect(BUNDLED_FONTS).toContain("Inter");
    const brief = brandBrief(kit, { fontFiles: [] });
    expect(brief).toContain('"Fraunces" (heading) is not available as a file');
    expect(brief).not.toContain('"Inter" (body) is not available');
  });

  it("does not ask for a substitution when the font file is supplied", () => {
    const brief = brandBrief({ ...kit, customFonts: [{ family: "Fraunces", file: "fraunces.woff2" }] }, { fontFiles: [{ family: "Fraunces", path: "assets/fonts/fraunces.woff2" }] });
    expect(brief).not.toContain("is not available as a file");
    expect(brief).toContain("@font-face");
  });
});
