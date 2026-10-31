/** Light / dark / follow-the-system. The `dark` class on <html> flips the colour variables defined in index.css. */
export type Theme = "system" | "light" | "dark";
const KEY = "maybe.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage blocked */ }
  return "system";
}

export const isDark = (t: Theme = getTheme()) => t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

export function applyTheme(t: Theme = getTheme()) {
  document.documentElement.classList.toggle("dark", isDark(t));
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}

/** Re-apply when the OS theme changes (only matters in "system" mode). */
export function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const on = () => getTheme() === "system" && applyTheme("system");
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}
