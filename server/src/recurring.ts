import { addDays } from "./util.js";

/** One transaction as the detector sees it: amount in the home currency, positive = money out. */
export type Txn = { date: string; amount: number; name: string; merchant: string | null; category_id?: string | null };

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export type Recurring = {
  key: string;
  name: string;
  direction: "expense" | "income";
  category_id: string | null; // the category most of its charges were filed under
  cadence: Cadence;
  amount: number; // typical amount, always positive
  monthly: number; // what it costs (or pays) per month on average
  count: number;
  first_date: string;
  last_date: string;
  next_due: string;
  active: boolean;
  history: { date: string; amount: number }[]; // newest first, at most 12
};

// [cadence, shortest gap, longest gap, typical gap in days, months of a year it covers per occurrence]
const CADENCES: { cadence: Cadence; min: number; max: number; days: number; perMonth: number }[] = [
  { cadence: "weekly", min: 6, max: 8, days: 7, perMonth: 52 / 12 },
  { cadence: "biweekly", min: 13, max: 16, days: 14, perMonth: 26 / 12 },
  { cadence: "monthly", min: 24, max: 38, days: 30, perMonth: 1 },
  { cadence: "quarterly", min: 85, max: 97, days: 91, perMonth: 1 / 3 },
  { cadence: "yearly", min: 355, max: 375, days: 365, perMonth: 1 / 12 },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const dayNum = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);

/** "NETFLIX.COM 8812 SG" and "Netflix.com 4410 SG" should land in the same group. */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[0-9#*]+/g, " ").replace(/[^a-z\s.&']/g, " ").replace(/\s+/g, " ").trim();
}

/** Same day of month, clamped to the month's length, `n` months later. */
export function addMonths(date: string, n: number, anchorDay = Number(date.slice(8, 10))): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchorDay, last))).toISOString().slice(0, 10);
}

export function step(date: string, cadence: Cadence, anchorDay?: number): string {
  switch (cadence) {
    case "weekly": return addDays(date, 7);
    case "biweekly": return addDays(date, 14);
    case "monthly": return addMonths(date, 1, anchorDay);
    case "quarterly": return addMonths(date, 3, anchorDay);
    case "yearly": return addMonths(date, 12, anchorDay);
  }
}

/** Every date this item is expected between `from` and `to` (inclusive), starting from its next due date. */
export function dueDates(r: Pick<Recurring, "cadence" | "next_due" | "last_date">, from: string, to: string): string[] {
  const anchor = Number(r.last_date.slice(8, 10));
  const out: string[] = [];
  let d = r.next_due;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (d >= from) out.push(d);
    d = step(d, r.cadence, anchor);
  }
  return out;
}

/**
 * Find repeating charges and deposits. A group counts as recurring when it has at least three occurrences
 * (two for yearly), most gaps between them match one cadence, and most amounts are close to the typical one.
 * `today` decides whether a series is still running: one that is more than about a cycle overdue is reported inactive.
 */
export function detectRecurring(txns: Txn[], today: string): Recurring[] {
  const groups = new Map<string, { name: string; direction: "expense" | "income"; items: Txn[] }>();
  for (const t of txns) {
    if (!t.amount) continue;
    const label = t.merchant?.trim() || t.name;
    const norm = normaliseName(label);
    if (!norm) continue;
    const direction = t.amount > 0 ? "expense" : "income";
    const key = `${direction}:${norm}`;
    const g = groups.get(key) ?? { name: t.merchant?.trim() || t.name.trim(), direction, items: [] };
    g.items.push(t);
    groups.set(key, g);
  }

  const out: Recurring[] = [];
  for (const [key, g] of groups) {
    const items = g.items.sort((a, b) => a.date.localeCompare(b.date));
    if (items.length < 2) continue;
    const gaps = items.slice(1).map((t, i) => dayNum(t.date) - dayNum(items[i]!.date));
    // two charges on one day (a retry, a split bill) are not a cycle
    const real = gaps.filter((g) => g > 3);
    if (real.length < 1) continue;
    const gap = median(real);
    const c = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!c) continue;
    const need = c.cadence === "yearly" ? 2 : 3;
    if (items.length < need) continue;
    // a month with no entry (or a payday that slid over a weekend) shouldn't break a series: a gap of two cycles still counts for the slow cadences
    const skips = c.days >= 30;
    const onCycle = real.filter((g) => (g >= c.min && g <= c.max) || (skips && g >= c.min * 2 && g <= c.max * 2)).length;
    if (onCycle / real.length < 0.6) continue;

    const amounts = items.map((t) => Math.abs(t.amount));
    const typical = median(amounts);
    const close = amounts.filter((a) => Math.abs(a - typical) <= typical * 0.15).length;
    if (close / amounts.length < 0.7) continue;

    const last = items[items.length - 1]!;
    const votes = new Map<string, number>();
    for (const t of items) if (t.category_id) votes.set(t.category_id, (votes.get(t.category_id) ?? 0) + 1);
    const category_id = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    // recent amounts are the best guess for the next one; the median of the last three ignores a one-off
    const amount = median(items.slice(-3).map((t) => Math.abs(t.amount)));
    const next = step(last.date, c.cadence);
    const grace = Math.max(7, Math.round(c.days * 0.5));
    out.push({
      key,
      name: g.name,
      direction: g.direction,
      category_id,
      cadence: c.cadence,
      amount,
      monthly: amount * c.perMonth,
      count: items.length,
      first_date: items[0]!.date,
      last_date: last.date,
      next_due: next,
      active: addDays(next, grace) >= today,
      history: items.slice(-12).reverse().map((t) => ({ date: t.date, amount: Math.abs(t.amount) })),
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.next_due.localeCompare(b.next_due));
}
