import { readTimeline } from "../engine/timeline.js";
import { snapshotProject } from "../engine/tools.js";
import { DIMENSIONS, readMeta } from "../projects/store.js";
import { makeClient } from "../providers/client.js";
import { getReviewerProvider } from "../providers/store.js";

const MAX_FRAMES = 6;
const MAX_REPLY_CHARS = 4000;

export const REVIEWER_SYSTEM = `You are a strict QA reviewer for an HTML motion video. You are shown still frames taken at stated times. You cannot see the code. Report only concrete problems you can SEE in these frames.

Look for:
- a frame that is blank or nearly empty where content should be, or the same content in frames that should show different scenes (a scene that never appears);
- text cut off by the frame edge, hidden behind another element, or overlapping other text;
- text too small to read at video size, or with poor contrast against its background;
- elements that stick out of the frame or sit where a phone app's interface would cover them (for a portrait video: the top 12% and bottom 20% of the height);
- broken or missing images, and leftover placeholder text such as "Title" or "Lorem ipsum";
- duplicated words, wrong or garbled text.

Rules:
- Frames are single instants. Do not flag something only because it looks mid-animation, partly faded, or still arriving.
- Do not suggest a redesign or new ideas. Do not comment on taste.
- Do not invent facts. If you cannot tell, say so.
- Answer as a short list, one line per problem: "<time> s: <what is wrong and where in the frame>". If there is nothing wrong, answer exactly: No visible problems.`;

/** Frames worth looking at (rounded down to 0.1 s, so the last one never lands on or after the end): shortly after each clip starts, so a scene that never shows is caught. */
export function pickTimes(duration: number, starts: number[]): number[] {
  const end = Math.max(0.1, duration - 0.05);
  const candidates = starts.map((s) => Math.min(end, s + 0.8));
  const base = candidates.length > 0 ? candidates : [duration * 0.15, duration * 0.4, duration * 0.65, duration * 0.9];
  const unique = [...new Set(base.map((t) => Math.floor(Math.max(0, Math.min(end, t)) * 10 + 1e-9) / 10))].sort((a, b) => a - b);
  if (unique.length <= MAX_FRAMES) return unique;
  // Too many: keep an even spread, always including the first and the last.
  return Array.from({ length: MAX_FRAMES }, (_, i) => unique[Math.round((i * (unique.length - 1)) / (MAX_FRAMES - 1))] ?? 0);
}

export type ReviewOutcome = { ok: true; times: number[]; text: string } | { ok: false; reason: string };

/** Photograph the video at `times` (or at sensible moments) and have the reviewer model say what looks wrong. */
export async function reviewFrames(projectId: string, opts: { times?: number[]; focus?: string }, signal?: AbortSignal): Promise<ReviewOutcome> {
  const provider = getReviewerProvider();
  if (!provider) return { ok: false, reason: "No reviewer is set up (Settings → Reviewer). Rely on `check`." };

  const meta = await readMeta(projectId);
  const view = await readTimeline(projectId);
  const times = opts.times && opts.times.length > 0 ? opts.times.slice(0, MAX_FRAMES) : pickTimes(view.duration, view.clips.filter((c) => !c.nested).map((c) => c.start));
  const snaps = await snapshotProject(projectId, times, signal);
  if (snaps.length === 0) return { ok: false, reason: "No frames could be captured." };

  const { width, height } = DIMENSIONS[meta.orientation];
  const intro = `Video: ${width}×${height} (${meta.orientation}), ${view.duration.toFixed(1)} s long. ${snaps.length} frames follow, each labelled with its time.${opts.focus ? ` The director asks you to pay special attention to: ${opts.focus.slice(0, 500)}` : ""}`;
  const content = [
    { type: "text" as const, text: intro },
    ...snaps.flatMap((s, i) => [
      { type: "text" as const, text: `Frame ${i + 1} at ${times[i]?.toFixed(1) ?? "?"} s:` },
      { type: "image_url" as const, image_url: { url: `data:image/png;base64,${s.bytes.toString("base64")}` } },
    ]),
  ];

  const res = await makeClient(provider).chat.completions.create(
    {
      model: provider.model,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: "system", content: REVIEWER_SYSTEM },
        { role: "user", content },
      ],
    },
    { signal },
  );
  const text = (res.choices[0]?.message.content ?? "").trim();
  if (text.length === 0) return { ok: false, reason: "The reviewer returned nothing." };
  return { ok: true, times, text: text.slice(0, MAX_REPLY_CHARS) };
}
