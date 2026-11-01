import { isHidden, MASK } from "./privacy";

export function money(n: number, currency = "USD", opts: Intl.NumberFormatOptions = {}) {
  if (isHidden()) return MASK;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2, ...opts }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export const moneyCompact = (n: number, currency: string) => money(n, currency, { notation: "compact", maximumFractionDigits: 1 });

export function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, opts);
}

export const todayStr = () => new Date().toLocaleDateString("en-CA");

export function monthLabel(m: string) {
  return new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export const currentMonth = () => todayStr().slice(0, 7);
/** The month in the page's `?month=YYYY-MM` link, or the current month. */
export const monthFromUrl = () => {
  const m = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("month");
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth();
};

export const TYPE_LABELS: Record<string, string> = {
  Depository: "Cash & bank", Investment: "Investments", Crypto: "Crypto", Property: "Property", Vehicle: "Vehicles",
  OtherAsset: "Other assets", CreditCard: "Credit cards", Loan: "Loans", OtherLiability: "Other liabilities",
};

export const ASSET_TYPES = ["Depository", "Investment", "Crypto", "Property", "Vehicle", "OtherAsset"];
export const LIABILITY_TYPES = ["CreditCard", "Loan", "OtherLiability"];

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Axis / compact numbers: blank when amounts are hidden. */
export const axisNum = (v: number) => (isHidden() ? "" : v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));

/** Whole part + smaller fraction, e.g. "SGD 39,193" and ".02", for hero balances. */
export function moneyParts(n: number, currency = "USD"): { main: string; cents: string } {
  if (isHidden()) return { main: MASK, cents: "" };
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(n);
    const i = parts.findIndex((p) => p.type === "decimal");
    if (i < 0) return { main: parts.map((p) => p.value).join(""), cents: "" };
    return { main: parts.slice(0, i).map((p) => p.value).join(""), cents: parts.slice(i).map((p) => p.value).join("") };
  } catch {
    return { main: `${currency} ${Math.trunc(n)}`, cents: "" };
  }
}

export const TYPE_ICONS: Record<string, string> = {
  Depository: "card", Investment: "trend", Crypto: "coin", Property: "building", Vehicle: "car",
  OtherAsset: "categories", CreditCard: "card", Loan: "building", OtherLiability: "categories",
};
