import type { WordTiming } from "./types.js";

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Lowercase letters and digits only, so "Caption," and "caption" compare equal. */
export function normWord(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

/** How well two words match: 1 for equal, a little less for a near miss ("mengikuti" vs "menikuti"), 0 otherwise. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  return editDistance(a, b) / Math.max(a.length, b.length) <= 0.34 ? 0.7 : 0;
}

/**
 * Spread words over `duration` seconds in proportion to their length, leaving a pause after sentence and clause
 * marks. Used when nothing measured the audio. Right to within a few hundred milliseconds per word, so callers
 * must say it is an estimate.
 */
export function estimateByLength(words: string[], duration: number, lead = 0.05): WordTiming[] {
  const parts = words.map((w) => {
    const chars = Math.max(1, normWord(w).length);
    const pause = /[.!?]$/.test(w) ? 4 : /[,;:]$/.test(w) ? 2 : 0;
    return { text: w, chars, pause };
  });
  const total = parts.reduce((n, p) => n + p.chars + p.pause, 0);
  if (total === 0) return [];
  const scale = Math.max(0, duration - lead) / total;
  const out: WordTiming[] = [];
  let at = lead;
  for (const p of parts) {
    const start = at;
    at += p.chars * scale;
    out.push({ text: p.text, start: round3(start), end: round3(at) });
    at += p.pause * scale;
  }
  return out;
}

/**
 * Give the words of the script the times whisper measured for the words it heard. The script is the truth for the
 * text (captions must show what was written, not whisper's spelling), whisper is the truth for the timing.
 * Words are matched in order with a tolerance for small recognition errors; a script word whisper did not hear gets
 * a share of the gap between its neighbours.
 */
export function alignScriptToHeard(script: string[], heard: WordTiming[], duration: number): WordTiming[] {
  if (script.length === 0) return [];
  if (heard.length === 0) return estimateByLength(script, duration);

  const s = script.map(normWord);
  const h = heard.map((w) => normWord(w.text));
  const n = s.length;
  const m = h.length;

  // Best in-order matching (longest common subsequence, with near misses counting a little less).
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const sim = wordSimilarity(s[i] ?? "", h[j] ?? "");
      const take = sim > 0 ? sim + (best[i + 1]?.[j + 1] ?? 0) : -1;
      best[i]![j] = Math.max(take, best[i + 1]?.[j] ?? 0, best[i]?.[j + 1] ?? 0);
    }
  }
  const anchor = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    const sim = wordSimilarity(s[i] ?? "", h[j] ?? "");
    if (sim > 0 && Math.abs((best[i]?.[j] ?? 0) - (sim + (best[i + 1]?.[j + 1] ?? 0))) < 1e-9) {
      anchor[i] = j;
      i++;
      j++;
    } else if ((best[i + 1]?.[j] ?? 0) >= (best[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }

  const speechStart = heard[0]?.start ?? 0;
  const speechEnd = Math.max(heard.at(-1)?.end ?? duration, speechStart);
  const out: WordTiming[] = new Array<WordTiming>(n);
  let i = 0;
  while (i < n) {
    const j = anchor[i] ?? -1;
    if (j >= 0) {
      out[i] = { text: script[i] ?? "", start: round3(heard[j]?.start ?? 0), end: round3(heard[j]?.end ?? 0) };
      i++;
      continue;
    }
    // A run of script words with no match: share the gap between the previous and the next matched word.
    let k = i;
    while (k < n && (anchor[k] ?? -1) < 0) k++;
    const from = i > 0 ? (out[i - 1]?.end ?? speechStart) : speechStart;
    const nextJ = k < n ? (anchor[k] ?? -1) : -1;
    const to = nextJ >= 0 ? (heard[nextJ]?.start ?? speechEnd) : speechEnd;
    const weights = script.slice(i, k).map((w) => Math.max(1, normWord(w).length));
    const total = weights.reduce((a, b) => a + b, 0);
    let at = from;
    for (let r = 0; r < weights.length; r++) {
      const share = (Math.max(0, to - from) * (weights[r] ?? 1)) / total;
      out[i + r] = { text: script[i + r] ?? "", start: round3(at), end: round3(at + share) };
      at += share;
    }
    i = k;
  }

  // Times must never go backwards or overlap, whatever the matching did.
  for (let x = 1; x < out.length; x++) {
    const prev = out[x - 1]!;
    const cur = out[x]!;
    if (cur.start < prev.end) out[x] = { ...cur, start: prev.end, end: Math.max(prev.end, cur.end) };
  }
  return out;
}
