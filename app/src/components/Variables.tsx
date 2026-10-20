import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { FileVariables, Project, Variable, VariableValue } from "../types";

/** `<input type=color>` only accepts #rrggbb. */
function toHex6(c: string): string {
  const m = /^#([0-9a-fA-F]{3})$/.exec(c);
  if (m?.[1]) return `#${[...m[1]].map((ch) => ch + ch).join("")}`;
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000";
}

function Field({ v, onCommit, disabled }: { v: Variable; onCommit: (value: VariableValue) => void; disabled: boolean }) {
  const [text, setText] = useState(String(v.default));
  const debounce = useRef<number | undefined>(undefined);
  useEffect(() => setText(String(v.default)), [v.default]);

  switch (v.type) {
    case "boolean":
      return <input type="checkbox" checked={v.default === true} disabled={disabled} onChange={(e) => onCommit(e.target.checked)} />;
    case "enum":
      return (
        <select value={String(v.default)} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
          {(v.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
          ))}
        </select>
      );
    case "color":
      return (
        <div className="row">
          <input
            type="color"
            value={toHex6(text)}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              // The picker fires continuously while dragging; commit once it settles.
              clearTimeout(debounce.current);
              const next = e.target.value;
              debounce.current = window.setTimeout(() => onCommit(next), 500);
            }}
          />
          <input value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={() => text !== v.default && onCommit(text)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        </div>
      );
    case "number":
      return (
        <div className="row">
          <input
            type="number"
            value={text}
            min={v.min}
            max={v.max}
            step={v.step}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => Number(text) !== v.default && text.trim() !== "" && onCommit(Number(text))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          {v.unit && <span className="muted">{v.unit}</span>}
        </div>
      );
    case "string":
      return (
        <input
          value={text}
          maxLength={v.maxLength}
          placeholder={v.placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== v.default && onCommit(text)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      );
  }
}

export function VariablesPanel({ project, reloadKey, onEdited }: { project: Project; reloadKey: number; onEdited: () => void }) {
  const [groups, setGroups] = useState<FileVariables[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => api.variables(project.id).then((g) => { setGroups(g); setError(null); }, (e: Error) => setError(e.message)), [project.id]);
  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  async function commit(file: string, id: string, value: VariableValue) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.setVariable(project.id, file, id, value);
      if (!res.ok) setError(res.reason);
      else onEdited();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (groups && groups.length === 0) {
    return (
      <div className="empty">
        This video has no editable variables yet. Ask the director: “make the headline, subtitle and accent colour editable variables”.
      </div>
    );
  }

  return (
    <div className="vars">
      {error && <div className="notice error">{error}</div>}
      {groups?.map((g) => (
        <fieldset key={g.file}>
          <legend>{g.file}</legend>
          {g.variables.map((v) => (
            <label key={v.id} className={v.type === "boolean" ? "check" : ""}>
              <span>{v.label ?? v.id} <code>{v.id}</code></span>
              <Field v={v} disabled={saving} onCommit={(value) => void commit(g.file, v.id, value)} />
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
