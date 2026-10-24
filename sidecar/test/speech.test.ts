import { describe, expect, it } from "vitest";
import { captionLook, resolveSpeech } from "../src/agent/speech.js";
import { DEFAULT_PREFERENCES, type Preferences } from "../src/preferences.js";

const prefs = (over: Partial<Preferences> = {}): Preferences => ({
  ...DEFAULT_PREFERENCES,
  voiceVendor: "openai",
  voiceId: "nova",
  voiceRate: 1.25,
  captionStyle: "pop",
  captionPosition: "top",
  ...over,
});

describe("what the director's voiceover takes from Settings", () => {
  it("uses the saved vendor, voice, speed, caption style and position when the model names none", () => {
    const { tts, captions } = resolveSpeech({ text: "Halo" }, prefs(), "landscape");
    expect(tts).toEqual({ text: "Halo", provider: "openai", voice: "nova", rate: 1.25 });
    expect(captions).toMatchObject({ style: "pop", position: "top", fontSize: 54 });
  });

  it("lets the model choose a style and a voice when the user asked for them, but still uses the saved speed", () => {
    const { tts, captions } = resolveSpeech({ text: "Hi", voice: "shimmer", captionStyle: "clean" }, prefs(), "portrait");
    expect(tts).toMatchObject({ provider: "openai", voice: "shimmer", rate: 1.25 });
    expect(captions).toMatchObject({ style: "clean", position: "top", fontSize: 64 });
  });

  it("does not hand the saved voice to a different vendor", () => {
    const { tts } = resolveSpeech({ text: "Hi", provider: "edge" }, prefs(), "landscape");
    expect(tts.provider).toBe("edge");
    expect(tts.voice).toBeUndefined();
  });

  it("never turns captions on when Settings has them off, and can turn them off for one voiceover", () => {
    expect(resolveSpeech({ text: "x", withCaptions: true }, prefs({ captionsOn: false }), "landscape").captions).toBeUndefined();
    expect(resolveSpeech({ text: "x", withCaptions: false }, prefs(), "landscape").captions).toBeUndefined();
    expect(resolveSpeech({ text: "x" }, prefs(), "landscape").captions).toBeDefined();
  });

  it("captions an imported file with the saved style and position", () => {
    expect(captionLook(prefs(), "landscape")).toMatchObject({ style: "pop", position: "top" });
    expect(captionLook(prefs(), "landscape", "classic").style).toBe("classic");
  });
});
