export interface Palette {
  primary: string;
  accent: string;
  background: string;
  text: string;
}

export const DEFAULT_PALETTE: Palette = { primary: "#3b82f6", accent: "#ff7a3d", background: "#0f1115", text: "#f5f5f5" };

type Rgb = [number, number, number];

/** `#abc` and `#aabbcc` (and 8-digit with alpha, alpha dropped) to lowercase `#rrggbb`; null for anything else. */
export function normalizeHex(input: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!m?.[1]) return null;
  const h = m[1].toLowerCase();
  if (h.length === 3) return `#${[...h].map((c) => c + c).join("")}`;
  return `#${h.slice(0, 6)}`;
}

function toRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Colourfulness: 0 for greys, up to 1 for a fully saturated colour. */
export function saturation(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Turn the colours a website uses into a brand palette: the two most colourful colours become primary and accent,
 * the darkest and lightest become background and text. Missing roles fall back to the defaults, so a site that is
 * all grey still yields a usable kit. This is a starting point for the user to edit, not a design decision.
 */
export function pickPalette(colors: string[]): Palette {
  const unique = [...new Set(colors.map(normalizeHex).filter((c): c is string => c !== null))];
  if (unique.length === 0) return { ...DEFAULT_PALETTE };

  const byLight = [...unique].sort((a, b) => luminance(a) - luminance(b));
  const darkest = byLight[0];
  const lightest = byLight.at(-1);
  const bright = unique.filter((c) => saturation(c) >= 0.35 && luminance(c) > 0.04 && luminance(c) < 0.9).sort((a, b) => saturation(b) - saturation(a));

  // A dark site gets a dark background and light text; a light site gets the reverse, so text stays readable.
  const dark = darkest !== undefined && luminance(darkest) < 0.2;
  const background = dark ? (darkest ?? DEFAULT_PALETTE.background) : DEFAULT_PALETTE.background;
  const text = lightest !== undefined && luminance(lightest) > 0.6 ? lightest : DEFAULT_PALETTE.text;
  return {
    primary: bright[0] ?? DEFAULT_PALETTE.primary,
    accent: bright[1] ?? bright[0] ?? DEFAULT_PALETTE.accent,
    background,
    text,
  };
}

const GENERIC_FONTS: Record<string, true> = {
  "system-ui": true, "sans-serif": true, serif: true, monospace: true, cursive: true, inherit: true,
  "-apple-system": true, blinkmacsystemfont: true, "segoe ui": true, arial: true, helvetica: true, "times new roman": true,
};

/** A font name that is safe to store (plain characters) and is not just a system fallback. */
export function pickFonts(families: string[]): { heading: string; body: string } {
  const usable = families
    .map((f) => f.trim().replace(/\s+/g, " "))
    .filter((f) => /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(f) && !GENERIC_FONTS[f.toLowerCase()]);
  const heading = usable[0] ?? "Poppins";
  return { heading, body: usable[1] ?? (usable[0] ? usable[0] : "Inter") };
}
