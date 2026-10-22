import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "memotion.theme";
const inTauri = "__TAURI_INTERNALS__" in window;
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

export function savedTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** The two looks are told apart by `data-theme` on <html>: dark is the base style, light overrides it. */
export function applyTheme(choice: ThemeChoice): void {
  const resolved = choice === "system" ? (systemDark.matches ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = resolved;
}

export function setTheme(choice: ThemeChoice): void {
  if (choice === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
  applyTheme(choice);
  // The title bar and scroll bars of the window follow too. Cosmetic: a failure leaves the page itself themed.
  if (inTauri) void getCurrentWindow().setTheme(choice === "system" ? null : choice).catch(() => undefined);
}

/** Call once at start: applies the saved choice, and follows the system while the choice is "system". */
export function startTheme(): void {
  const saved = savedTheme();
  applyTheme(saved);
  if (inTauri && saved !== "system") void getCurrentWindow().setTheme(saved).catch(() => undefined);
  systemDark.addEventListener("change", () => {
    if (savedTheme() === "system") applyTheme("system");
  });
}
