const MAX_WORDS = 6;
const MAX_CHARS = 40;

/** A project name from the first words of a prompt: no markup, no mentions, no trailing punctuation. */
export function nameFromPrompt(prompt: string, fallback = "Untitled video"): string {
  const words = prompt
    .replace(/@\S+/g, " ")
    .replace(/[`*_#>\[\]()"“”]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  let name = words.join(" ");
  if (name.length > MAX_CHARS) name = name.slice(0, MAX_CHARS).replace(/\s+\S*$/, "");
  name = name.replace(/[\s.,;:!?-]+$/, "");
  if (name.length === 0) return fallback;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A stable colour for a project's letter avatar, from its id. Hues skip the app's own orange. */
export function avatarHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hues = [152, 200, 262, 330, 45, 180, 290, 100];
  return hues[h % hues.length] ?? 152;
}

export function ago(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
