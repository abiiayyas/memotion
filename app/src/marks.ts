import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "./api";
import type { DrawingAttachment, MarkComment, Selection, Target } from "./types";

export type Tool = "select" | "draw" | "comment";

// ── talking to the pick script inside the preview page ───────────────────────────────────

const TargetSchema: z.ZodType<Target> = z.object({
  selector: z.string(),
  id: z.string().nullish(),
  tag: z.string(),
  classes: z.array(z.string()).default([]),
  text: z.string().nullish(),
  media: z.string().nullish(),
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  compositionId: z.string().nullish(),
  compositionFile: z.string().nullish(),
  start: z.string().nullish(),
  duration: z.string().nullish(),
  styles: z.record(z.string(), z.string()).default({}),
});

/** What the pick script posts. Anything else on the window (the runtime's own messages) fails to parse and is ignored. */
const PickMessage = z.object({
  source: z.literal("memotion-pick"),
  type: z.string(),
  reqId: z.number().optional(),
  target: TargetSchema.nullish(),
  targets: z.array(TargetSchema).optional(),
});
type PickMessage = z.infer<typeof PickMessage>;

export interface Picker {
  /** Highlight the element under a point (no result needed). */
  hover: (x: number, y: number) => void;
  leave: () => void;
  /** Select the element under a point and keep it highlighted. Calls back with null when nothing is there or the page is silent. */
  select: (x: number, y: number, done: (target: Target | null) => void) => void;
  /** The distinct elements under these points (for a drawing and for a comment). */
  describe: (points: [number, number][], done: (targets: Target[]) => void) => void;
  /** Select an element again by its selector (after the page reloaded). */
  reselect: (selector: string) => void;
  clear: () => void;
  /** False until the page's pick script has said hello (a stale or still-loading page cannot answer). */
  ready: boolean;
}

const ANSWER_TIMEOUT_MS = 4000;

// Callbacks, not promises: the app targets Safari 15, which has no Promise.withResolvers.
export function usePicker(frameRef: React.RefObject<HTMLIFrameElement | null>, reloadKey: string): Picker {
  const [ready, setReady] = useState(false);
  const pending = useRef<Record<number, ((m: PickMessage | null) => void) | undefined>>({});
  const seq = useRef(0);

  const send = useCallback(
    (m: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage({ source: "memotion-parent", ...m }, "*"),
    [frameRef],
  );

  // A new page (reload, new project) has to introduce itself again.
  useEffect(() => setReady(false), [reloadKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const parsed = PickMessage.safeParse(e.data);
      if (!parsed.success) return;
      if (parsed.data.type === "ready") setReady(true);
      const id = parsed.data.reqId;
      const done = id === undefined ? undefined : pending.current[id];
      if (id !== undefined && done) {
        pending.current[id] = undefined;
        done(parsed.data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef]);

  const ask = useCallback(
    (m: Record<string, unknown>, done: (answer: PickMessage | null) => void) => {
      const reqId = ++seq.current;
      pending.current[reqId] = done;
      send({ ...m, reqId });
      // A page that never answers must not leave the tool waiting forever.
      setTimeout(() => {
        const waiting = pending.current[reqId];
        if (waiting) {
          pending.current[reqId] = undefined;
          waiting(null);
        }
      }, ANSWER_TIMEOUT_MS);
    },
    [send],
  );

  return useMemo<Picker>(
    () => ({
      ready,
      hover: (x, y) => send({ type: "hover", x, y }),
      leave: () => send({ type: "leave" }),
      clear: () => send({ type: "clear" }),
      reselect: (selector) => ask({ type: "select", selector }, () => undefined),
      select: (x, y, done) => ask({ type: "select", x, y }, (a) => done(a?.target ?? null)),
      describe: (points, done) => ask({ type: "describe", points }, (a) => done(a?.targets ?? [])),
    }),
    [ready, send, ask],
  );
}

// ── what the user has marked so far ──────────────────────────────────────────────────────

export interface MarkState {
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  drawing: DrawingAttachment | null;
  setDrawing: (d: DrawingAttachment | null) => void;
  comments: MarkComment[];
  reloadComments: () => Promise<void>;
  /** Whether open comments travel with the next message. */
  includeComments: boolean;
  setIncludeComments: (on: boolean) => void;
}

export function useMarkState(projectId: string | null): MarkState {
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawing, setDrawing] = useState<DrawingAttachment | null>(null);
  const [comments, setComments] = useState<MarkComment[]>([]);
  const [includeComments, setIncludeComments] = useState(true);

  const reloadComments = useCallback(async () => {
    if (!projectId) return setComments([]);
    try {
      setComments(await api.comments(projectId));
    } catch {
      setComments([]);
    }
  }, [projectId]);

  // Marks belong to one project.
  useEffect(() => {
    setSelection(null);
    setDrawing(null);
    void reloadComments();
  }, [projectId, reloadComments]);

  return { tool, setTool, selection, setSelection, drawing, setDrawing, comments, reloadComments, includeComments, setIncludeComments };
}
