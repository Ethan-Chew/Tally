/**
 * "Hide amounts" mode. A module-level flag read by `money()` so every amount in the app is masked at the source
 * (text, chart tooltips, axes, inputs). App re-renders the whole tree when it flips.
 */
const KEY = "maybe.hideAmounts";
let hidden = false;
try { hidden = localStorage.getItem(KEY) === "1"; } catch { /* private mode: just don't persist */ }

export const MASK = "••••";
export const isHidden = () => hidden;
export function setHidden(v: boolean) {
  hidden = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
}
