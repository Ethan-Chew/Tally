import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs, type Entry } from "../api";
import { EntryList } from "../components/EntryList";
import { TransactionModal } from "../components/EntryForms";
import { ReportTabs } from "../components/ReportTabs";
import { Empty, LoadMore, PageSkeleton, Pills } from "../components/ui";
import { useEntries } from "../hooks";
import { axisNum, cx, fmtDate, money } from "../lib";
import { bounds, RANGE_LABELS, type Range } from "../ranges";

interface Series { id: string | null; name: string; color: string | null; total: number; values: number[] }
interface Resp {
  currency: string; from: string; to: string; months: string[]; series: Series[]; total: number;
  summary: { count: number; largest: number; average: number; total: number };
}

// used when the grouping has no colour of its own (merchants, some tags)
const PALETTE = ["#5266eb", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16", "#f97316", "#14b8a6", "#a855f7"];
const GREY = "#9ca3af";
const FILTER_KEY = { category: "category_id", tag: "tag_id", merchant: "merchant_id" } as const;
const GROUP_LABEL = { category: "category", merchant: "merchant", tag: "tag" } as const;
const monthShort = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: m.endsWith("-01") ? "2-digit" : undefined });
const tip = { borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" };

export default function ReportsPage() {
  const kind = useLocation().pathname.endsWith("/income") ? "income" : "expense";
  const [group, setGroup] = useState<"category" | "merchant" | "tag">("category");
  const [range, setRange] = useState<Range>("3m");
  const [view, setView] = useState<"total" | "time">("total");
  const [sel, setSel] = useState<string | null>(null); // a legend entry the transaction list is narrowed to
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const { from, to } = useMemo(() => bounds(range), [range]);
  const q = useQuery({ queryKey: ["reports", from, to, group, kind], queryFn: () => api<Resp>(`/api/reports${qs({ from, to, group, kind })}`), placeholderData: (p) => p });
  const d = q.data;
  const series = useMemo(() => d?.series.map((s, i) => ({ ...s, key: s.id ?? s.name, color: s.color ?? (s.id === null ? GREY : PALETTE[i % PALETTE.length]!) })) ?? [], [d]);
  const rows = useMemo(() => d?.months.map((m, i) => ({ month: m, ...Object.fromEntries(series.map((s, j) => [`s${j}`, s.values[i]])) })) ?? [], [d, series]);

  const chosen = series.find((s) => s.key === sel && s.id);
  const list = useEntries({ from, to, type: kind, ...(chosen ? { [FILTER_KEY[group]]: chosen.id } : {}) }, 30);

  if (!d) return <PageSkeleton />;
  const cur = d.currency;
  const title = `${kind === "expense" ? "Spending" : "Income"} by ${GROUP_LABEL[group]}`;
  const start = d.from > "2001-01-01" ? d.from : `${d.months[0] ?? d.from.slice(0, 7)}-01`;
  const pct = (n: number) => (d.total ? ` (${((n / d.total) * 100).toFixed(1)}%)` : "");

  const download = async () => {
    // fetch every matching transaction, not just the ones scrolled into view
    const all: Entry[] = [];
    for (let page = 1; ; page++) {
      const r = await api<{ rows: Entry[]; total: number }>(`/api/entries${qs({ from, to, type: kind, page, per_page: 200, ...(chosen ? { [FILTER_KEY[group]]: chosen.id } : {}) })}`);
      all.push(...r.rows);
      if (!r.rows.length || all.length >= r.total) break;
    }
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Date,Name,Category,Merchant,Account,Amount,Currency", ...all.map((e) => [e.date, e.name, e.category_name, e.merchant_name, e.account_name, e.amount, e.currency].map(cell).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${kind}-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="page-title">Reports</h1>
        <select className="input !h-10 !w-auto !rounded-xl" aria-label="Date range" value={range} onChange={(e) => { setRange(e.target.value as Range); setSel(null); }}>
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
        </select>
      </div>
      <ReportTabs />

      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-5 py-5 sm:px-7">
          <div>
            <div className="eyebrow">{title}</div>
            <div className="mt-1 text-[19px] font-semibold tracking-tight">{fmtDate(start)} – {fmtDate(d.to)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input !h-10 !w-auto !rounded-xl" aria-label="Group by" value={group} onChange={(e) => { setGroup(e.target.value as typeof group); setSel(null); }}>
              <option value="category">By category</option><option value="merchant">By merchant</option><option value="tag">By tag</option>
            </select>
            <Pills value={view} onChange={setView} options={[{ value: "total", label: "Total amounts" }, { value: "time", label: "Change over time" }]} />
          </div>
        </div>

        {!series.length ? <Empty>Nothing to report in this period.</Empty> : view === "total" ? (
          <div className="grid grid-cols-1 items-center gap-8 px-5 py-8 sm:px-7 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="relative mx-auto h-64 w-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={series} dataKey="total" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={1} stroke="none" onClick={(_, i) => setSel(series[i]!.key === sel ? null : series[i]!.key)} onMouseEnter={(_, i) => setHover(series[i]!.key)} onMouseLeave={() => setHover(null)}>
                    {series.map((s) => <Cell key={s.key} fill={s.color} fillOpacity={sel && sel !== s.key ? 0.3 : 1} className="cursor-pointer outline-none" />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [money(Number(v), cur), n]} contentStyle={tip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[22px] font-semibold tabular-nums tracking-tight">{money(chosen?.total ?? d.total, cur, { maximumFractionDigits: 0 })}</div>
                <div className="muted text-sm">{chosen ? chosen.name : "Total"}</div>
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
              {series.map((s) => (
                <li key={s.key}>
                  <button disabled={!s.id} onClick={() => setSel(sel === s.key ? null : s.key)} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} aria-pressed={sel === s.key}
                    className={cx("flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition", (hover === s.key || sel === s.key) && "bg-soft", !s.id && "cursor-default")}>
                    <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px]">{s.name}</span>
                      <span className="block text-[14px] font-semibold tabular-nums">{money(s.total, cur)}<span className="muted font-normal">{pct(s.total)}</span></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="h-80 px-2 py-6 sm:px-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} width={44} tickFormatter={axisNum} />
                <Tooltip cursor={{ fill: "var(--color-zinc-50)" }} labelFormatter={(m) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })} formatter={(v, n) => [money(Number(v), cur), series[Number(String(n).slice(1))]?.name ?? ""]} contentStyle={tip} />
                {series.map((s, j) => <Bar key={s.key} dataKey={`s${j}`} stackId="a" fill={s.color} maxBarSize={44} radius={j === series.length - 1 ? [4, 4, 0, 0] : 0} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card overflow-hidden">
          <div className="card-head">
            <h2 className="section-title">Transactions{chosen && <span className="muted font-normal"> · {chosen.name}</span>}</h2>
            {chosen && <button className="btn" onClick={() => setSel(null)}>Clear</button>}
          </div>
          {!list.loaded ? <div className="muted p-10 text-center text-sm">Loading…</div> : list.rows.length === 0 ? <Empty>No transactions.</Empty> : (
            <>
              <EntryList entries={list.rows} onEdit={setEditing} />
              <LoadMore onVisible={list.loadMore} loading={list.isFetchingNextPage} hasMore={list.hasMore} />
            </>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="card-head"><h2 className="section-title">Summary</h2></div>
          <dl className="divide-y divide-zinc-100 text-sm">
            {[
              ["Total transactions", String(d.summary.count)],
              ["Largest transaction", money(d.summary.largest, cur)],
              ["Average transaction", money(d.summary.average, cur)],
              [kind === "expense" ? "Total spending" : "Total income", money(d.summary.total, cur)],
            ].map(([k, v]) => <div key={k} className="flex justify-between px-5 py-3.5 sm:px-7"><dt className="muted">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
          </dl>
          <div className="border-t border-zinc-100 px-5 py-4 text-center sm:px-7"><button className="text-sm font-medium text-accent hover:underline" onClick={download}>Download CSV</button></div>
        </section>
      </div>
      {editing && <TransactionModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
