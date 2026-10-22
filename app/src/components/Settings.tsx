import { useEffect, useState } from "react";
import { AboutSection } from "./settings/AboutSection";
import { AgentsSection } from "./settings/AgentsSection";
import { AppearanceSection } from "./settings/AppearanceSection";
import { GeneralSection } from "./settings/GeneralSection";
import { MediaSection } from "./settings/MediaSection";
import { RenderingSection } from "./settings/RenderingSection";
import { ShortcutsSection } from "./settings/ShortcutsSection";
import { StorageSection } from "./settings/StorageSection";

type SectionId = "general" | "appearance" | "agents" | "media" | "rendering" | "storage" | "shortcuts" | "about";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
  { id: "media", label: "Media" },
  { id: "rendering", label: "Rendering" },
  { id: "storage", label: "Storage & Privacy" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

export function Settings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [section, setSection] = useState<SectionId>("general");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = SECTIONS.find((s) => s.id === section)?.label ?? "";
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sd-body">
          <nav className="sd-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.id} className={s.id === section ? "on" : ""} aria-current={s.id === section ? "page" : undefined} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="sd-content">
            <h2 className="sd-heading">{label}</h2>
            {section === "general" && <GeneralSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "agents" && <AgentsSection onChanged={onChanged} />}
            {section === "media" && <MediaSection />}
            {section === "rendering" && <RenderingSection />}
            {section === "storage" && <StorageSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
