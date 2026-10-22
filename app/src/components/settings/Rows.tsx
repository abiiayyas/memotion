import { useEffect, useState, type ReactNode } from "react";

/** One setting: what it is on the left, the control on the right. */
export function Row({ title, desc, children, stack = false }: { title: string; desc?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`sd-row ${stack ? "stack" : ""}`}>
      <div className="sd-text">
        <div className="sd-title">{title}</div>
        {desc && <div className="sd-desc">{desc}</div>}
      </div>
      {children && <div className="sd-control">{children}</div>}
    </div>
  );
}

/** Pick one of a few values. Used for On/Off too, so every choice looks the same. */
export function Seg<T extends string | number | boolean>({ value, options, onChange, label, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className="sd-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ON_OFF = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];

export function Switch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Seg value={value} options={ON_OFF} onChange={onChange} label={label} disabled={disabled} />;
}

/** A slider that shows the value while it moves and tells the caller only when the user lets go. */
export function Slider({ value, min, max, step = 1, unit, onCommit, label, disabled }: { value: number; min: number; max: number; step?: number; unit: string; onCommit: (v: number) => void; label: string; disabled?: boolean }) {
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const commit = () => {
    if (shown !== value) onCommit(shown);
  };
  return (
    <div className="sd-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => setShown(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{shown}{unit}</output>
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  return <div className={`notice ${kind === "error" ? "error" : kind === "ok" ? "okmsg" : kind === "warn" ? "warn" : ""}`}>{children}</div>;
}
