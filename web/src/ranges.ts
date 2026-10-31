import { todayStr } from "./lib";

export type Range = "month" | "last" | "3m" | "6m" | "ytd" | "12m" | "all";

export const RANGE_LABELS: Record<Range, string> = {
  month: "This month", last: "Last month", "3m": "Last 3 months", "6m": "Last 6 months", ytd: "Year to date", "12m": "Last 12 months", all: "All time",
};

const iso = (d: Date) => d.toLocaleDateString("en-CA");

/** First and last day (inclusive, ending today unless the range is a past month) of a named range. */
export function bounds(r: Range): { from: string; to: string } {
  const t = new Date(todayStr() + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth();
  const first = (back: number) => iso(new Date(y, m - back, 1));
  switch (r) {
    case "month": return { from: first(0), to: iso(t) };
    case "last": return { from: first(1), to: iso(new Date(y, m, 0)) };
    case "3m": return { from: first(2), to: iso(t) };
    case "6m": return { from: first(5), to: iso(t) };
    case "ytd": return { from: `${y}-01-01`, to: iso(t) };
    case "12m": return { from: first(11), to: iso(t) };
    case "all": return { from: "2000-01-01", to: iso(t) };
  }
}
