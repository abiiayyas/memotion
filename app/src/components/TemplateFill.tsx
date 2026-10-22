import { useEffect, useState } from "react";
import { templateThumbUrl } from "../api";
import type { Variable, VariableValue } from "../types";

export function FillField({ v, value, onChange }: { v: Variable; value: VariableValue; onChange: (value: VariableValue) => void }) {
  switch (v.type) {
    case "boolean":
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "enum":
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {(v.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
        </select>
      );
    case "color":
      return <input type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 28, padding: 0 }} />;
    case "number":
      return <input type="number" value={Number(value)} min={v.min} max={v.max} step={v.step} onChange={(e) => onChange(Number(e.target.value))} />;
    case "string":
      return <input value={String(value)} maxLength={v.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function TemplateThumb({ id, className }: { id: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void templateThumbUrl(id).then(setSrc);
  }, [id]);
  return src ? <img src={src} alt="" className={className ?? "tpl-thumb"} /> : null;
}
