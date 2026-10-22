import { describe, expect, it } from "vitest";
import { ago, avatarHue, nameFromPrompt } from "./projectName";

describe("nameFromPrompt", () => {
  it("takes the first few words, capitalised, without trailing punctuation", () => {
    expect(nameFromPrompt("buat video promo kopi senja untuk instagram minggu depan, ya")).toBe("Buat video promo kopi senja untuk");
    expect(nameFromPrompt("teaser kopi!")).toBe("Teaser kopi");
  });

  it("drops @mentions and markdown, so a project is not named after a file or a symbol", () => {
    expect(nameFromPrompt("@foto-kopi.png jadikan hook video")).toBe("Jadikan hook video");
    expect(nameFromPrompt("# **Promo** `kopi`")).toBe("Promo kopi");
  });

  it("keeps long single words under the character limit and falls back when nothing is left", () => {
    expect(nameFromPrompt("a ".repeat(100)).length).toBeLessThanOrEqual(40);
    expect(nameFromPrompt("Pneumonoultramicroscopicsilicovolcanoconiosis kopi sangat panjang sekali").length).toBeLessThanOrEqual(40);
    expect(nameFromPrompt("   @file.png  ")).toBe("Untitled video");
    expect(nameFromPrompt("", "My template")).toBe("My template");
  });
});

describe("avatarHue", () => {
  it("is stable for an id, so a project keeps its colour", () => {
    expect(avatarHue("kopi-1a2b3c")).toBe(avatarHue("kopi-1a2b3c"));
    const hues = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(avatarHue));
    expect(hues.size).toBeGreaterThan(2);
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
  it("speaks in the unit a person would", () => {
    expect(ago(at(5), now)).toBe("just now");
    expect(ago(at(5 * 60), now)).toBe("5 min ago");
    expect(ago(at(3 * 3600), now)).toBe("3 h ago");
    expect(ago(at(2 * 86400), now)).toBe("2 d ago");
  });
  it("never reports a negative time for a clock that is slightly ahead", () => {
    expect(ago(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });
});
