import { open } from "@tauri-apps/plugin-dialog";

const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * A path typed or pasted by the user, with a Browse button in the desktop app. Browsers never reveal file paths,
 * so outside Tauri the text field is the only way in, which also keeps every flow testable without native dialogs.
 */
export function PathField({
  value,
  onChange,
  placeholder,
  directory = false,
  extensions,
  disabled,
  label,
}: {
  value: string;
  onChange: (path: string) => void;
  placeholder: string;
  directory?: boolean;
  extensions?: string[];
  disabled?: boolean;
  label: string;
}) {
  async function browse() {
    const picked = await open({
      multiple: false,
      directory,
      filters: !directory && extensions ? [{ name: label, extensions }] : undefined,
    });
    if (typeof picked === "string") onChange(picked);
  }

  return (
    <div className="row" style={{ alignItems: "center", flexWrap: "nowrap" }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} aria-label={label} spellCheck={false} />
      {inTauri && (
        <button type="button" onClick={() => void browse()} disabled={disabled}>
          Browse…
        </button>
      )}
    </div>
  );
}
