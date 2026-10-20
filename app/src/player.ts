import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewMessage {
  source: "hf-preview";
  type: string;
  currentTime?: number;
  isPlaying?: boolean;
  durationSeconds?: number;
}

function isPreviewMessage(v: unknown): v is PreviewMessage {
  return typeof v === "object" && v !== null && "source" in v && v.source === "hf-preview" && "type" in v;
}

export interface Player {
  /** Attach to the preview <iframe>. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  time: number;
  duration: number;
  playing: boolean;
  seek: (seconds: number) => void;
  toggle: () => void;
  pause: () => void;
  /** Call right before the preview reloads: the playhead returns to this time once the new page reports ready. */
  rememberTime: () => void;
}

/**
 * Drives the HyperFrames runtime inside the preview iframe. The runtime listens for
 * `{source:"hf-parent", type:"control", action}` and reports `{source:"hf-preview", type:"state"|"timeline"}`.
 */
export function usePlayer(): Player {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const resumeAt = useRef<number | null>(null);

  const control = useCallback((action: string, extra: Record<string, unknown> = {}) => {
    frameRef.current?.contentWindow?.postMessage({ source: "hf-parent", type: "control", action, ...extra }, "*");
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || !isPreviewMessage(e.data)) return;
      if (e.data.type === "state") {
        timeRef.current = e.data.currentTime ?? 0;
        setTime(timeRef.current);
        setPlaying(e.data.isPlaying === true);
      } else if (e.data.type === "timeline" && e.data.durationSeconds) {
        setDuration(e.data.durationSeconds);
        // The composition just became ready after a reload: put the playhead back where the user left it.
        if (resumeAt.current !== null) {
          control("pause");
          control("seek", { timeSeconds: resumeAt.current });
          resumeAt.current = null;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [control]);

  const seek = useCallback(
    (seconds: number) => {
      timeRef.current = seconds;
      setTime(seconds);
      control("seek", { timeSeconds: seconds });
    },
    [control],
  );

  return {
    frameRef,
    time,
    duration,
    playing,
    seek,
    toggle: () => control(playing ? "pause" : "play"),
    pause: () => control("pause"),
    rememberTime: () => {
      resumeAt.current = timeRef.current;
    },
  };
}
