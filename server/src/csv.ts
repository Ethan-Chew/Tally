/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM) with delimiter sniffing. */
export function parseCsv(text: string): { delimiter: string; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return { delimiter, rows };
}

export type DateFormat = "auto" | "ymd" | "dmy" | "mdy";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Returns YYYY-MM-DD or null. */
export function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, ""); // drop a time part
  const mk = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return mk(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3})[A-Za-z]*[\s\-/.,]+(\d{2,4})$/); // 05 Jan 2026
  if (m) { const mi = MONTHS.indexOf(m[2]!.toLowerCase()); return mi >= 0 ? mk(+m[3]!, mi + 1, +m[1]!) : null; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    if (fmt === "mdy") return mk(y, a, b);
    if (fmt === "dmy") return mk(y, b, a);
    return null; // ambiguous without a declared format
  }
  return null;
}

/** When the user hasn't picked a format, look for a value that can only be day-first (13/05) or month-first (05/13). */
export function inferDateFormat(values: string[]): DateFormat {
  let dmy = false, mdy = false;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    const a = +m[1]!, b = +m[2]!;
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  return dmy && !mdy ? "dmy" : mdy && !dmy ? "mdy" : "auto";
}

/** Parses "1,234.56", "1.234,56", "(12.50)", "-$12", "12.50-", "S$ 12" -> number, or NaN. */
export function parseAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); }
  s = s.replace(/[^\d.,-]/g, "").replace(/^-/, () => { neg = !neg; return ""; });
  if (!/\d/.test(s)) return NaN;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

const GUESS: Record<string, RegExp> = {
  date: /^(date|posted|posting date|transaction date|trans\.? date|booking date)/i,
  name: /^(name|description|details|memo|payee|narration|merchant|reference)/i,
  amount: /^(amount|value|sum)$/i,
  debit: /^(debit|withdrawal|withdrawals|money out|paid out|outflow)/i,
  credit: /^(credit|deposit|deposits|money in|paid in|inflow)/i,
  category: /^category/i,
  notes: /^(notes?|comment|remarks?|memo)/i,
};
export function guessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, re] of Object.entries(GUESS)) {
    const h = headers.find((x) => re.test(x.trim()) && !Object.values(out).includes(x));
    if (h) out[key] = h;
  }
  return out;
}
