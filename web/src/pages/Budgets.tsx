import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Budget } from "../api";
import { Icon } from "../components/Icon";
import { CatBadge, ErrorNote, PageSkeleton } from "../components/ui";
import { useAction } from "../hooks";
import { axisNum, currentMonth, cx, fmtDate, money, monthLabel, todayStr } from "../lib";
import { isHidden, MASK } from "../privacy";

interface History { month: string; budgeted: number | null; spent: number; income: number }

/** Reads like plain text; shows a border on hover and saves on blur / Enter. */
function InlineAmount({ value, onSave, label, className, fit }: { value: number; onSave: (n: number) => void; label: string; className?: string; fit?: boolean }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(/,/g, ""));
    if (text.trim() === "" || !Number.isFinite(n) || n < 0) return setText(String(value));
    if (n !== value) onSave(n);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={isHidden() && !focused ? MASK : text}
      style={fit ? { width: `${Math.max(text.length, 2) + 2}ch` } : undefined}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(String(value)); e.currentTarget.blur(); } }}
      className={cx("rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums outline-none transition hover:border-zinc-200 hover:bg-white focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10", className)}
    />
  );
}

/** Segmented ring: one arc per category, sized against the larger of budget and spending. */
function Ring({ segments, scale, size = 232 }: { segments: { color: string; value: number }[]; scale: number; size?: number }) {
  const stroke = 14, r = (size - stroke) / 2, C = 2 * Math.PI * r, gap = 5;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-zinc-100)" strokeWidth={stroke} />
      {segments.map((s, i) => {
        const full = (s.value / scale) * C;
        const len = full - gap;
        const el = len > 1 ? <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} /> : null;
        offset += full;
        return el;
      })}
    </svg>
  );
}

/** Category icon wrapped in a progress ring (spent vs. budget; red when over). */
function RingBadge({ c, frac, over }: { c: { name: string; color: string; lucide_icon: string }; frac: number; over: boolean }) {
  const size = 50, stroke = 2.5, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  return (
    <div className="relative h-[50px] w-[50px] shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-zinc-100)" strokeWidth={stroke} />
        {frac > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? "#ef4444" : c.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${Math.min(1, frac) * C} ${C}`} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center"><CatBadge size="sm" name={c.name} color={c.color} icon={c.lucide_icon} /></div>
    </div>
  );
}

export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const [showUnused, setShowUnused] = useState(false);
  const { data: b, isLoading } = useQuery({ queryKey: ["budget", month], queryFn: () => api<Budget>(`/api/budgets/${month}`), placeholderData: (p) => p });
  const history = useQuery({ queryKey: ["budget-history"], queryFn: () => api<History[]>("/api/budgets?months=12") });
  const save = useAction((body: object) => api<Budget>(`/api/budgets/${month}`, { method: "PUT", body }));

  const view = useMemo(() => {
    if (!b) return null;
    const [y, m] = b.month.split("-").map(Number) as [number, number];
    const daysInMonth = new Date(y, m, 0).getDate();
    const today = todayStr();
    const isCurrent = today.startsWith(b.month);
    const isFuture = today < b.month + "-01";
    const elapsed = isCurrent ? Number(today.slice(8)) : isFuture ? 0 : daysInMonth;
    const total = b.budgeted_spending;
    const remaining = total - b.actual_spending;
    const daysLeft = isCurrent ? daysInMonth - elapsed + 1 : 0; // today still counts
    const projected = isCurrent && elapsed > 0 ? (b.actual_spending / elapsed) * daysInMonth : b.actual_spending;

    let status: { label: string; tone: "good" | "warn" | "bad" | "idle" } = { label: "No budget set", tone: "idle" };
    if (total > 0) {
      if (b.actual_spending > total) status = { label: "Over budget", tone: "bad" };
      else if (isCurrent && projected > total * 1.02) status = { label: "On pace to overspend", tone: "warn" };
      else status = { label: isCurrent ? "On track" : "Under budget", tone: "good" };
    }

    // cumulative spending per day, vs. an even-spend pace line
    const byDay = new Map(b.daily.map((d) => [d.date, d.spent]));
    let run = 0;
    const series = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${b.month}-${String(i + 1).padStart(2, "0")}`;
      run += byDay.get(date) ?? 0;
      return { day: i + 1, date, spent: i + 1 <= elapsed ? Math.round(run * 100) / 100 : null, pace: total > 0 ? Math.round(((total * (i + 1)) / daysInMonth) * 100) / 100 : null };
    });

    const sorted = [...b.categories].sort((x, y) => y.actual_spending - x.actual_spending || y.budgeted_spending - x.budgeted_spending || x.name.localeCompare(y.name));
    const used = sorted.filter((c) => c.budgeted_spending > 0 || c.actual_spending > 0);
    const unused = sorted.filter((c) => c.budgeted_spending === 0 && c.actual_spending === 0);
    return { daysInMonth, isCurrent, elapsed, total, remaining, daysLeft, projected, status, series, used, unused };
  }, [b]);

  if (isLoading || !b || !view) return <PageSkeleton />;
  const cur = b.currency;
  const f0 = (n: number) => money(n, cur, { maximumFractionDigits: 0 });
  const { total, remaining, status, series, used, unused } = view;
  const over = total > 0 && b.actual_spending > total;
  const setCat = (category_id: string) => (n: number) => save.mutate({ categories: [{ category_id, budgeted_spending: n }] });
  const scale = Math.max(total, b.actual_spending, 1);
  const stack = [...b.categories].filter((c) => c.actual_spending > 0).sort((x, y) => y.actual_spending - x.actual_spending);
  const tone = { good: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-red-50 text-red-700", idle: "bg-tint text-accent" }[status.tone];
  const rows = showUnused ? [...used, ...unused] : used;

  const incomeLeft = b.expected_income - b.actual_income;
  const segs = [...stack.map((c) => ({ color: c.color, value: c.actual_spending })), ...(b.uncategorized_spending > 0.005 ? [{ color: "#d4d4d8", value: b.uncategorized_spending }] : [])];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* month bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="icon-btn" onClick={() => setMonth(b.prev_month)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
          <button className="icon-btn" onClick={() => setMonth(b.next_month)} aria-label="Next month"><Icon name="chevronRight" /></button>
          <h1 className="page-title ml-2 !text-[22px] sm:!text-[26px]">{monthLabel(month)}</h1>
        </div>
        {month !== currentMonth() && <button className="btn" onClick={() => setMonth(currentMonth())}>Today</button>}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* left: ring + summaries */}
        <div className="space-y-6">
          <section className="card p-6 sm:p-7">
            <div className="relative mx-auto flex w-fit items-center justify-center">
              <Ring segments={segs} scale={scale} />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="eyebrow">Spent</div>
                <div className={cx("mt-1 text-[30px] font-semibold leading-none tabular-nums tracking-tight", over && "text-rose-600")}>{money(b.actual_spending, cur, { maximumFractionDigits: 0 })}</div>
                <div className="mt-3 flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[13px] text-zinc-600">
                  of <InlineAmount fit className="!px-1 !text-left font-medium text-zinc-900" label="Total monthly budget" value={total} onSave={(n) => save.mutate({ budgeted_spending: n })} />
                  <Icon name="edit" className="h-3.5 w-3.5 text-zinc-400" />
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <span className={cx("rounded-full px-3 py-1 text-xs font-medium", tone)}>{status.label}</span>
              {view.isCurrent && total > 0 && remaining > 0 && <span className="chip !bg-soft !text-zinc-700">{f0(remaining / view.daysLeft)} / day</span>}
              {view.isCurrent && <span className={cx("chip !bg-soft", total > 0 && view.projected > total ? "!text-amber-600" : "!text-zinc-700")}>→ {f0(view.projected)}</span>}
            </div>
          </section>

          <section className="card divide-y divide-zinc-100">
            <div className="p-6 sm:p-7">
              <div className="eyebrow">Expected income</div>
              <div className="mt-1 flex items-baseline gap-1.5 text-[24px] font-semibold"><span className="text-zinc-400">{cur}</span><InlineAmount fit className="!px-1 !text-left text-[24px] font-semibold" label="Expected income" value={b.expected_income} onSave={(n) => save.mutate({ expected_income: n })} /></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.expected_income > 0 ? Math.min(100, (b.actual_income / b.expected_income) * 100) : 0}%` }} /></div>
              <div className="mt-3 flex justify-between text-[13px]">
                <span className="muted">{f0(b.actual_income)} earned</span>
                {b.expected_income > 0 && <span className={incomeLeft <= 0 ? "text-emerald-600" : "muted"}>{incomeLeft <= 0 ? `${f0(-incomeLeft)} over` : `${f0(incomeLeft)} to go`}</span>}
              </div>
            </div>
            <div className="p-6 sm:p-7">
              <div className="eyebrow">Budgeted</div>
              <div className="mt-1 text-[24px] font-semibold tabular-nums tracking-tight">{money(total, cur, { maximumFractionDigits: 0 })}</div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"><div className={cx("h-full rounded-full", over ? "bg-rose-500" : "bg-accent")} style={{ width: `${total > 0 ? Math.min(100, (b.actual_spending / total) * 100) : 0}%` }} /></div>
              <div className="mt-3 flex justify-between text-[13px]">
                <span className="muted">{f0(b.actual_spending)} spent</span>
                {total > 0 && <span className={over ? "text-rose-600" : "muted"}>{over ? `${f0(-remaining)} over` : `${f0(remaining)} left`}</span>}
              </div>
            </div>
          </section>
          <ErrorNote error={save.error} />
        </div>

        {/* right: categories */}
        <section className="card overflow-hidden">
          <div className="card-head">
            <h2 className="section-title">Categories</h2>
            {total > 0 && Math.abs(b.unallocated_spending) >= 0.5 && <span className="chip">{f0(Math.abs(b.unallocated_spending))} {b.unallocated_spending > 0 ? "unassigned" : "over total"}</span>}
          </div>
          <div className="flex items-center justify-between bg-soft/60 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:px-7">
            <span>Categories · {b.categories.length}</span><span>Spent · Budget</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {rows.map((c) => {
              const left = c.budgeted_spending - c.actual_spending;
              const isOver = c.budgeted_spending > 0 && left < 0;
              return (
                <li key={c.category_id} className="flex items-center gap-4 px-5 py-4 sm:px-7">
                  <RingBadge c={c} frac={c.budgeted_spending > 0 ? c.actual_spending / c.budgeted_spending : 0} over={isOver} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{c.name}</div>
                    <div className={cx("mt-0.5 text-[13px] tabular-nums", isOver ? "text-rose-600" : "text-zinc-500")}>
                      {c.budgeted_spending > 0 ? (isOver ? `${f0(-left)} over` : `${f0(left)} left`) : c.actual_spending > 0 ? "No budget" : "Unused"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular-nums">{money(c.actual_spending, cur, { maximumFractionDigits: 0 })}</div>
                    <div className="mt-0.5 flex items-center justify-end text-[13px] text-zinc-500">
                      from <InlineAmount fit className="!px-1 !text-right text-[13px]" label={`${c.name} budget`} value={c.budgeted_spending} onSave={setCat(c.category_id)} />
                    </div>
                  </div>
                </li>
              );
            })}
            {b.uncategorized_spending > 0.005 && (
              <li className="flex items-center gap-4 px-5 py-4 sm:px-7">
                <CatBadge name={null} color="#9ca3af" icon={null} />
                <div className="min-w-0 flex-1 text-[14px] font-medium">Uncategorized</div>
                <div className="text-[14px] font-semibold tabular-nums">{f0(b.uncategorized_spending)}</div>
              </li>
            )}
          </ul>
          {unused.length > 0 && (
            <button className="w-full border-t border-zinc-100 px-5 py-4 text-left text-[13px] font-medium text-accent hover:bg-tint/50 sm:px-7" onClick={() => setShowUnused(!showUnused)}>
              {showUnused ? "Hide unused categories" : `Show ${unused.length} unused categor${unused.length === 1 ? "y" : "ies"}`}
            </button>
          )}
        </section>
      </div>

      {/* 2 · am I on pace */}
      {total > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="section-title">Spending pace</h2>
            </div>
            <div className="muted flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-accent" />Spent</span>
              <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-zinc-400" />Even pace</span>
            </div>
          </div>
          <div className="h-56 px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <defs><linearGradient id="pace" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5266eb" stopOpacity={0.14} /><stop offset="100%" stopColor="#5266eb" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} interval={Math.ceil(series.length / 8) - 1} />
                <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} width={44} domain={[0, Math.max(total, b.actual_spending) * 1.05]} tickFormatter={axisNum} />
                <Tooltip formatter={(v, n) => [money(Number(v), cur), n === "pace" ? "Even pace" : "Spent"]} labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDate(p[0].payload.date) : "")} contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" }} />
                <Area type="stepAfter" dataKey="spent" stroke="#5266eb" strokeWidth={2} fill="url(#pace)" connectNulls={false} dot={false} />
                <Line type="linear" dataKey="pace" stroke="var(--chart-axis)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 4 · the long view */}
      {history.data && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="section-title">Last 12 months</h2>
            </div>
            <div className="muted flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />Spent</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-tint-strong" />Budget</span>
            </div>
          </div>
          <div className="h-52 px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history.data.map((h) => ({ ...h, label: new Date(h.month + "-01T00:00:00").toLocaleDateString(undefined, { month: "short" }), budgeted: h.budgeted ?? 0 }))} barGap={3}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} axisLine={false} tickLine={false} width={44} tickFormatter={axisNum} />
                <Tooltip cursor={{ fill: "var(--color-zinc-50)" }} formatter={(v, n) => [money(Number(v), cur), n === "budgeted" ? "Budget" : "Spent"]} contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" }} />
                <Bar dataKey="budgeted" fill="var(--color-tint-strong)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="spent" fill="#5266eb" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
