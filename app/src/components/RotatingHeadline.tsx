import { useEffect, useState } from "react";

const ENDINGS = ["move", "meaningful", "come alive", "feel", "from a thought"];
const HOLD_MS = 2600;

/** "Make something" stays put; only what follows it changes, one ending after another. */
export function RotatingHeadline() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % ENDINGS.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <h1 aria-label="Make something">
      Make something <span key={i} className="headline-ending" aria-hidden="true">{ENDINGS[i]}.</span>
    </h1>
  );
}
