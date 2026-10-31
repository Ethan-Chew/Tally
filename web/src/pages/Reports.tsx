import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../api";
import { Empty, PageSkeleton, Pills } from "../components/ui";
import { axisNum, cx, fmtDate, money, todayStr } from "../lib";

interface Series { id: string | null; name: string; color: string | null; total: number; values: number[] }
interface Resp { currency: string; from: string; to: string; months: string[]; series: Series[]; total: number }

type Range = "3m" | "6m" | "ytd" | "12m" | "all";
const RANGES: { value: Range; label: string }[] = [{ value: "3m", label: "3M" }, { value: "6m", label: "6M" }, { value: "ytd", label: "YTD" }, { value: "12m", label: "12M" }, { value: "all", label: "All" }];
// used when the grouping has no colour of its own (merchants, some tags)
const PALETTE = ["#5266eb", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];
const GREY = "#9ca3af";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
function bounds(r: Range): { from: string; to: string } {
  const t = new Date(todayStr() + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth();
  const first = (back: number) => iso(new Date(y, m - back, 1));
  switch (r) {
    case "3m": return { from: first(2), to: iso(t) };
    case "6m": return { from: first(5), to: iso(t) };
    case "ytd": return { from: `${y}-01-01`, to: iso(t) };
    case "12m": return { from: first(11), to: iso(t) };
    case "all": return { from: "2000-01-01", to: iso(t) };
  }
}
const monthShort = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: m.endsWith("-01") ? "2-digit" : undefined });
const FILTER_KEY = { category: "category_id", tag: "tag_id", merchant: "merchant_id" } as const;

export default function ReportsPage() {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [group, setGroup] = useState<"category" | "merchant" | "tag">("category");
  const [range, setRange] = useState<Range>("6m");
  const { from, to } = useMemo(() => bounds(range), [range]);
  const q = useQuery({ queryKey: ["reports", from, to, group, kind], queryFn: () => api<Resp>(`/api/reports${qs({ from, to, group, kind })}`), placeholderData: (p) => p });
  const d = q.data;
  const colored = useMemo(() => d?.series.map((s, i) => ({ ...s, color: s.color ?? (s.name.startsWith("Other") || s.id === null ? GREY : PALETTE[i % PALETTE.length]!) })) ?? [], [d]);
  const rows = useMemo(() => d?.months.map((m, i) => ({ month: m, ...Object.fromEntries(colored.map((s, j) => [`s${j}`, s.values[i]])) })) ?? [], [d, colored]);
  if (!d) return <PageSkeleton />;
  const cur = d.currency;
  const months = d.months.length || 1;

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="muted mt-1 text-sm">{fmtDate(d.from > "2001-01-01" ? d.from : (d.months[0] ?? d.from) + "-01")} – {fmtDate(d.to)}</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Pills value={kind} onChange={setKind} options={[{ value: "expense", label: "Spending" }, { value: "income", label: "Income" }]} />
          <Pills value={group} onChange={setGroup} options={[{ value: "category", label: "Category" }, { value: "merchant", label: "Merchant" }, { value: "tag", label: "Tag" }]} />
          <Pills value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <section className="card grid grid-cols-2 lg:grid-cols-3 lg:divide-x lg:divide-zinc-100">
        <div className="px-5 py-5 sm:px-7"><div className="eyebrow">Total</div><div className="stat mt-1.5">{money(d.total, cur, { maximumFractionDigits: 0 })}</div></div>
        <div className="px-5 py-5 sm:px-7"><div className="eyebrow">Per month</div><div className="stat mt-1.5">{money(d.total / months, cur, { maximumFractionDigits: 0 })}</div></div>
        <div className="col-span-2 border-t border-zinc-100 px-5 py-5 sm:px-7 lg:col-span-1 lg:border-t-0">
          <div className="eyebrow">Biggest</div><div className="stat mt-1.5 truncate">{colored[0]?.name ?? "—"}</div>
        </div>
      </section>

      {!colored.length ? <Empty>Nothing to report in this period.</Empty> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card">
            <div className="card-head"><h2 className="section-title">By month</h2></div>
            <div className="h-72 px-2 py-4 sm:px-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} width={44} tickFormatter={axisNum} />
                  <Tooltip
                    cursor={{ fill: "var(--color-zinc-50)" }}
                    labelFormatter={(m) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                    formatter={(v, n) => [money(Number(v), cur), colored[Number(String(n).slice(1))]?.name ?? ""]}
                    contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" }}
                  />
                  {colored.map((s, j) => <Bar key={j} dataKey={`s${j}`} stackId="a" fill={s.color!} maxBarSize={36} radius={j === colored.length - 1 ? [4, 4, 0, 0] : 0} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card self-start overflow-hidden">
            <div className="card-head"><h2 className="section-title">Ranked</h2></div>
            <ul className="divide-y divide-zinc-100">
              {colored.map((s) => {
                const link = s.id && group !== "merchant" ? `/transactions${qs({ [FILTER_KEY[group]]: s.id, from, to: d.to, type: kind })}` : null;
                const inner = (
                  <>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color! }} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="muted text-xs tabular-nums">{d.total ? Math.round((s.total / d.total) * 100) : 0}%</span>
                      <span className="w-20 text-right font-medium tabular-nums">{money(s.total, cur, { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${d.total ? (s.total / d.total) * 100 : 0}%`, background: s.color! }} /></div>
                  </>
                );
                return <li key={s.id ?? s.name}>{link ? <Link to={link} className={cx("block px-5 py-3.5 hover:bg-soft sm:px-7")}>{inner}</Link> : <div className="px-5 py-3.5 sm:px-7">{inner}</div>}</li>;
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
