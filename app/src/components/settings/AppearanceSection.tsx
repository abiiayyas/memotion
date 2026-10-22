import { useState } from "react";
import { savedTheme, setTheme, type ThemeChoice } from "../../theme";
import { Row, Seg } from "./Rows";

export function AppearanceSection() {
  const [choice, setChoice] = useState<ThemeChoice>(savedTheme);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return (
    <Row title="Theme" desc={`Follow the system changes with it while the app is open. The system is ${systemDark ? "dark" : "light"} now. The video preview stays dark in both: it is a screen, not part of the interface.`}>
      <Seg
        label="Theme"
        value={choice}
        onChange={(v) => {
          setChoice(v);
          setTheme(v);
        }}
        options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
      />
    </Row>
  );
}
