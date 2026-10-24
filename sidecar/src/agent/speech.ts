import type { Preferences } from "../preferences.js";
import type { CaptionRequest, CaptionStyle, TtsRequest } from "../audio/types.js";

/** What the model may say about a voiceover. Anything it leaves out comes from Settings. */
export interface SpeechChoices {
  text: string;
  provider?: TtsRequest["provider"];
  voice?: string;
  withCaptions?: boolean;
  captionStyle?: CaptionStyle;
}

/**
 * The same size the editor's Voice tab starts from, so a voiceover made by the director looks like one made there.
 * Colours, font and words per line are the editor's defaults too.
 */
export function captionLook(prefs: Preferences, orientation: "landscape" | "portrait", style?: CaptionStyle): CaptionRequest {
  return {
    style: style ?? prefs.captionStyle,
    position: prefs.captionPosition,
    fontSize: orientation === "portrait" ? 64 : 54,
    fontFamily: "Inter",
    primaryColor: "#ffffff",
    accentColor: "#ff9d6b",
    wordsPerGroup: 3,
  };
}

/**
 * Settings are the user's defaults; the model overrides only what the user asked for in chat.
 * Captions are the exception: the Settings switch can only be used to turn them off, never on again by the model.
 * A voice id belongs to one vendor, so the saved voice is used only with the saved vendor.
 */
export function resolveSpeech(args: SpeechChoices, prefs: Preferences, orientation: "landscape" | "portrait"): { tts: TtsRequest; captions: CaptionRequest | undefined } {
  const provider = args.provider ?? prefs.voiceVendor;
  const voice = args.voice ?? (provider === prefs.voiceVendor ? prefs.voiceId : undefined);
  const captionsWanted = prefs.captionsOn && args.withCaptions !== false;
  return {
    tts: { text: args.text, provider, voice, rate: prefs.voiceRate },
    captions: captionsWanted ? captionLook(prefs, orientation, args.captionStyle) : undefined,
  };
}
