import { Icon, type IconName } from "./Icons";

/** A pill that is really a native <select>: keyboard and screen-reader behaviour for free. */
export function ChipSelect({ icon, label, value, onChange, children, disabled, title, active }: { icon: IconName; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean; title?: string; /** Highlighted when it differs from the default. */ active: boolean }) {
  return (
    <label className={`chip-select ${active ? "active" : ""}`} title={title}>
      <Icon name={icon} size={15} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
      <Icon name="chevron" size={13} />
    </label>
  );
}
