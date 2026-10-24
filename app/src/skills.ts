import { useEffect, useState } from "react";
import { api } from "./api";
import type { Skill } from "./types";

const CHANGED = "memotion:skills-changed";

/** Tell every list on screen that a skill was installed or removed (Settings sits on top of Home and the editor). */
export function skillsChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The installed skills, reloaded whenever one is installed or removed. */
export function useSkills(): Skill[] {
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    const load = () => void api.skills().then(setSkills, () => setSkills([]));
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  return skills;
}
