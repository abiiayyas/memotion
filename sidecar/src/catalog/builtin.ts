import type { Shelf } from "./shelves.js";

export interface BuiltInItem {
  id: string;
  name: string;
  description: string;
  /** Markdown the director follows. Concrete, and buildable as HTML/CSS/GSAP inside a HyperFrames composition. */
  body: string;
}

/**
 * Written for Memotion. A shelf with no items here is simply not offered until the user adds files of their own
 * under `<data dir>/catalog/<shelf>/`.
 */
export const BUILT_IN: Partial<Record<Shelf, BuiltInItem[]>> = {
  hook: [
    {
      id: "specific-number",
      name: "Specific number",
      description: "Open on one precise figure, large, already on screen at frame 0.",
      body: `Open with one precise number (for example "73%" or "11 minutes", never "lots"), set at least 160 px tall and already visible at frame 0: no fade-in from empty. Under it, one line of at most 8 words that says what the number measures. Hold 2 s, then cut to the first scene with the number echoed in its heading. The number must come from the user's prompt or a source they gave; if there is none, show a marked placeholder instead of inventing one.`,
    },
    {
      id: "fake-ui",
      name: "Fake UI",
      description: "A notification or message mock-up that makes the thumb stop.",
      body: `Open on a believable phone UI built in HTML/CSS: a notification banner sliding in, a chat bubble typing, or a search box being filled. It is on screen at frame 0 (the banner starts already 30% in), readable at phone size, and says something the viewer would click. Hold 2-3 s, then the notification expands or the screen zooms into the first scene. Use generic app styling, never a real brand's logo.`,
    },
    {
      id: "social-proof",
      name: "Social proof",
      description: "Show the result or the count first, the story second.",
      body: `Open on the proof: a count, a rating, a before/after figure or a short quote, in a card centred on screen, at frame 0. Then one beat that asks "how?" and the story follows. Proof must be supplied by the user; mark any figure you were not given as a placeholder to replace, and never invent customers, ratings or quotes.`,
    },
    {
      id: "open-loop",
      name: "Open loop",
      description: "Pose a question or tease an outcome, and pay it off at the end.",
      body: `The first 2 s state a question or promise the video will answer ("This one setting made my edits 3x faster"), as large type, on screen at frame 0. Do not answer it in the first third: build with 2-3 scenes that each move closer. Pay it off in the last scene with the same words from the opening on screen again, so the loop visibly closes.`,
    },
    {
      id: "before-after",
      name: "Before / after split",
      description: "Open on the contrast: left is wrong, right is right.",
      body: `Open on a split frame at frame 0: left labelled "Before" (muted, cluttered), right labelled "After" (clean, on brand). A thin divider wipes left to right over 1 s to reveal the after side, then the video explains the change. Keep labels at least 64 px and the two halves the same subject so the difference reads in one glance.`,
    },
  ],
  visual: [
    {
      id: "comic-ink",
      name: "Comic ink",
      description: "Bold black outlines, halftone shading, speech-bubble type.",
      body: `Look: comic-book page. Thick black outlines (4-6 px strokes), flat saturated fills, halftone dots made with CSS radial-gradient for shading, a slightly off-white paper background. Type in heavy condensed sans-serif system fonts (or the brand font), in captions and speech bubbles with a tail. Motion: panels pop in with a small overshoot, hits get a starburst shape and a 2-frame screen shake. Keep to 3-4 colours plus black.`,
    },
    {
      id: "flat-explainer",
      name: "Flat explainer",
      description: "Clean flat shapes, simple icons, calm eased motion.",
      body: `Look: flat explainer. Solid shapes with no gradients or shadows, a limited palette of 4-5 colours, simple geometric icons built as inline SVG, generous whitespace. Motion: elements enter with eased slides and scale-ups (power2/power3), staggered 0.08-0.12 s, and leave before the next idea enters. One focal idea per scene.`,
    },
    {
      id: "neon-synthwave",
      name: "Neon synthwave",
      description: "Dark gradient sky, neon grid, glowing type.",
      body: `Look: synthwave. A dark violet-to-magenta gradient background, a perspective grid floor made with CSS transforms, a glowing sun with horizontal slits, neon type with layered text-shadow in cyan and pink. Motion: the grid scrolls toward the viewer on a loop, type flickers on once then holds, light sweeps cross the frame on scene changes. Avoid large flat white areas.`,
    },
    {
      id: "minimal-line-art",
      name: "Minimal line art",
      description: "One stroke colour on a plain background, drawn on.",
      body: `Look: minimal line art. A plain light or dark background, a single stroke colour plus one accent, 2-3 px uniform strokes, no fills except the accent. Draw shapes and underlines on with stroke-dashoffset tweens, then hold. Type in one light-weight sans-serif. Plenty of empty space; at most 2 elements move at once.`,
    },
  ],
  structure: [
    {
      id: "story-circle",
      name: "Story circle",
      description: "Go somewhere, change, return: eight beats in a loop.",
      body: `Structure the story in eight beats that loop: 1 a character in their comfort zone; 2 they want something; 3 they enter an unfamiliar situation; 4 they adapt; 5 they get what they wanted; 6 it costs them; 7 they return; 8 they have changed. Give each beat a scene of equal weight (merge beats 1-2 and 7-8 when the video is under 30 s). The last scene echoes the first with one visible difference.`,
    },
    {
      id: "three-act",
      name: "Three-act",
      description: "Setup, conflict with a mid-point twist, resolution.",
      body: `Act 1 (about 25% of the length): who, where, and what they want. Act 2 (about 50%): the obstacle grows, with a twist at the mid-point that changes what the viewer expected. Act 3 (about 25%): the decisive move and the result. Time the scenes to these shares and name each act in a code comment so the structure is visible when editing.`,
    },
    {
      id: "aida",
      name: "AIDA",
      description: "Attention, interest, desire, action: for promos.",
      body: `Four beats: Attention (hook in the first 2 s), Interest (one surprising fact about the subject), Desire (what life looks like with it, shown not told), Action (one clear call to action held for at least 2 s). Roughly 15% / 30% / 35% / 20% of the length. One message per beat; no beat repeats the previous one.`,
    },
  ],
};
