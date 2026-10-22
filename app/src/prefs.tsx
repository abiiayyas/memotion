import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Preferences } from "./types";

const SKIP_KEY = "memotion.skip";
export const SKIP_DEFAULT = 5;

function savedSkip(): number {
  const n = Number(localStorage.getItem(SKIP_KEY));
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : SKIP_DEFAULT;
}

export interface PrefsValue {
  /** What the sidecar keeps; null until it has answered. */
  prefs: Preferences | null;
  /** Seconds the playhead jumps with the skip buttons and Shift+arrow. Kept on this device only. */
  skip: number;
  update: (patch: Partial<Preferences>) => Promise<void>;
  reset: () => Promise<void>;
  setSkip: (seconds: number) => void;
}

const Ctx = createContext<PrefsValue>({ prefs: null, skip: SKIP_DEFAULT, update: () => Promise.resolve(), reset: () => Promise.resolve(), setSkip: () => undefined });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [skip, setSkipState] = useState(savedSkip);

  useEffect(() => {
    void api.preferences().then(setPrefs, () => setPrefs(null));
  }, []);

  // Changes go to the sidecar one after another, and only the answer to the newest one is shown: a slow earlier
  // answer must not put an older value back under the user's hand.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const newest = useRef(0);
  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
    const mine = ++newest.current;
    const sent = queue.current.then(() => api.setPreferences(patch));
    queue.current = sent.catch(() => undefined);
    return sent.then(
      (saved) => {
        if (mine === newest.current) setPrefs(saved);
      },
      async (e: unknown) => {
        // Refused: show what is really saved again, then tell the caller.
        if (mine === newest.current) setPrefs(await api.preferences());
        throw e;
      },
    );
  }, []);
  const reset = useCallback(async () => setPrefs(await api.resetPreferences()), []);
  const setSkip = useCallback((seconds: number) => {
    localStorage.setItem(SKIP_KEY, String(seconds));
    setSkipState(seconds);
  }, []);

  const value = useMemo(() => ({ prefs, skip, update, reset, setSkip }), [prefs, skip, update, reset, setSkip]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePrefs = (): PrefsValue => useContext(Ctx);
