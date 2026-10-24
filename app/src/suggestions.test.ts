import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, placeholders, suggestionLang, suggestionsFor, type SuggestionContext } from "./suggestions";

const base: SuggestionContext = { lang: "en", orientation: "landscape", formatId: "", hasSkill: false };

describe("prompt ideas under the empty box", () => {
  it("fit the chosen shape and never exceed the limit or repeat a chip", () => {
    const wide = suggestionsFor(base);
    const tall = suggestionsFor({ ...base, orientation: "portrait" });
    expect(wide.length).toBeGreaterThan(0);
    expect(wide.map((s) => s.text)).not.toEqual(tall.map((s) => s.text));
    const busiest = suggestionsFor({ ...base, formatId: "course-module", hasSkill: true, firstMedia: "logo.png" });
    expect(busiest).toHaveLength(MAX_SUGGESTIONS);
    expect(new Set(busiest.map((s) => s.label)).size).toBe(busiest.length);
  });

  it("put what the user already chose first: attached media, the Structure, then the skill", () => {
    const list = suggestionsFor({ ...base, formatId: "short-hook", hasSkill: true, firstMedia: "clip.mp4" });
    const general = suggestionsFor(base).map((s) => s.label);
    const ownIdeas = suggestionsFor({ ...base, formatId: "short-hook" }).slice(0, 3);
    expect(list[0]?.text).toContain("@clip.mp4");
    expect(list.slice(1, 4)).toEqual(ownIdeas);
    expect(ownIdeas.some((s) => general.includes(s.label))).toBe(false);
    expect(list[4]?.label).toMatch(/skill/i);
  });

  it("fall back to the general ideas for a format of the user's own", () => {
    expect(suggestionsFor({ ...base, formatId: "my-own-format" })).toEqual(suggestionsFor(base));
  });

  it("follow the reply language, or the system's when it is left on auto", () => {
    expect(suggestionLang("id", "en-US")).toBe("id");
    expect(suggestionLang("en", "id-ID")).toBe("en");
    expect(suggestionLang("auto", "id-ID")).toBe("id");
    expect(suggestionLang(undefined, "fr-FR")).toBe("en");
    expect(suggestionsFor({ ...base, lang: "id" })[0]?.text).toMatch(/Buat/);
  });

  it("every idea has blanks to fill, and they are found one by one", () => {
    for (const lang of ["en", "id"] as const) {
      for (const orientation of ["landscape", "portrait"] as const) {
        for (const formatId of ["", "course-module", "short-hook", "product-promo"]) {
          for (const s of suggestionsFor({ ...base, lang, orientation, formatId, hasSkill: true, firstMedia: "a.png" })) {
            expect(placeholders(s.text).length, s.label).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(placeholders("Promo for [product name] on [date]. Not [this\none]")).toEqual(["[product name]", "[date]"]);
  });
});
