import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs, type Budget, type BudgetCategory, type Entry } from "../api";
import { TransactionModal } from "../components/EntryForms";
import { Amount } from "../components/EntryList";
import { Icon } from "../components/Icon";
import { CatBadge, ErrorNote, PageSkeleton } from "../components/ui";
import { useAction } from "../hooks";
import { axisNum, currentMonth, monthFromUrl, cx, fmtDate, money, monthLabel, todayStr } from "../lib";
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
      title="Click to change"
      inputMode="decimal"
      value={isHidden() && !focused ? MASK : text}
      style={fit ? { width: `${Math.max(text.length, 2) + 2}ch` } : undefined}
      onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ""))}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(String(value)); e.currentTarget.blur(); } }}
      className={cx("rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right tabular-nums outline-none transition hover:border-zinc-200 hover:bg-white focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/10", className)}
    />
  );
}

/** Thin segmented ring: one arc per category, sized against the larger of budget and spending. */
function Ring({ segments, scale, size = 268 }: { segments: { color: string; value: number }[]; scale: number; size?: number }) {
  const stroke = 7, r = (size - stroke) / 2, C = 2 * Math.PI * r, gap = 14; // gap = visible space between arcs
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-zinc-100)" strokeWidth={1.5} />
      {segments.map((s, i) => {
        const full = (s.value / scale) * C;
        const len = full - gap - stroke; // round caps add stroke/2 at each end
        const el = len > 0.5 ? <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-(offset + (gap + stroke) / 2)} /> : null;
        offset += full;
        return el;
      })}
    </svg>
  );
}

const BUCKETS = [
  { key: "fixed", label: "Fixed", hint: "Mostly recurring monthly bills" },
  { key: "flexible", label: "Flexible", hint: "Everything else" },
  { key: "non_monthly", label: "Non-monthly", hint: "Mostly quarterly or yearly bills" },
] as const;

const shortDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** The transactions behind one category's spending, loaded when its row is opened. Same rules as the budget: exact category, nothing excluded. */
function CategoryTransactions({ categoryId, from, to, onEdit }: { categoryId: string | null; from: string; to: string; onEdit: (e: Entry) => void }) {
  const cat = categoryId ?? "none";
  const q = useQuery({
    queryKey: ["budget-transactions", cat, from, to],
    queryFn: () => api<{ rows: Entry[]; total: number }>(`/api/entries${qs({ category_id: cat, from, to, type: "expense", counted: 1, per_page: 8 })}`),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="border-t border-zinc-100 bg-soft/50 px-5 pb-3 pt-1 sm:px-7">
      {!q.data ? <p className="muted py-4 text-sm">Loading…</p> : rows.length === 0 ? <p className="muted py-4 text-sm">No transactions this month.</p> : (
        <ul className="divide-y divide-zinc-200/60">
          {rows.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onEdit(e)} className="flex w-full items-center gap-3 py-2.5 text-left text-[13px] hover:opacity-80">
                <span className="muted w-14 shrink-0 tabular-nums">{shortDay(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.name}{e.merchant_name && e.merchant_name !== e.name && <span className="muted"> · {e.merchant_name}</span>}</span>
                <Amount amount={e.amount} currency={e.currency} neutral className="shrink-0 font-medium !text-zinc-900" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.data && q.data.total > 0 && (
        <div className="flex items-center justify-between pb-1 pt-2 text-xs">
          <span className="muted">{q.data.total > rows.length ? `Latest ${rows.length} of ${q.data.total}` : `${q.data.total} transaction${q.data.total === 1 ? "" : "s"}`}</span>
          <Link to={`/transactions${qs({ category_id: cat, from, to })}`} className="font-medium text-accent hover:underline">See all →</Link>
        </div>
      )}
    </div>
  );
}

/** One category: name, a progress line, what was spent of the budget, and what is left. Click to see the transactions. */
function CatRow({ name, color, icon, spent, budget, left, cur, open, onToggle, onSave, children }: {
  name: string; color: string | null; icon: string | null; spent: number; budget?: number; left?: number; cur: string; open: boolean; onToggle: () => void; onSave?: (n: number) => void; children?: React.ReactNode;
}) {
  const f0 = (n: number) => money(n, cur, { maximumFractionDigits: 0 });
  const over = left !== undefined && left < -0.5;
  const frac = budget && budget > 0 ? Math.min(1, spent / budget) : spent > 0 ? 1 : 0;
  const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };
  return (
    <li>
      <div role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="flex cursor-pointer items-center gap-3.5 px-5 py-4 transition hover:bg-soft/60 sm:px-7">
        <CatBadge size="xs" name={name} color={color} icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[14px] font-medium">{name}</span>
            <span className="shrink-0 whitespace-nowrap text-[14px] tabular-nums">
              <span className="font-semibold">{f0(spent)}</span>
              {onSave && budget !== undefined && <span className="muted"> of <span {...stop}><InlineAmount fit className="!px-1 !py-0 text-[14px] !text-zinc-500" label={`${name} budget`} value={budget} onSave={onSave} /></span></span>}
            </span>
          </div>
          {budget !== undefined && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${frac * 100}%`, background: over ? "#ef4444" : (color ?? "#5266eb") }} /></div>
              <div className={cx("mt-1.5 text-xs tabular-nums", over ? "font-medium text-red-600" : "muted")}>
                {left === undefined || budget === 0 && spent === 0 ? "No budget" : over ? `${f0(-left)} over` : `${f0(left)} left`}
              </div>
            </>
          )}
        </div>
        <Icon name="chevronDown" className={cx("h-4 w-4 shrink-0 text-zinc-400 transition", open && "rotate-180")} />
      </div>
      {open && children}
    </li>
  );
}

export default function Budgets() {
  const [month, setMonth] = useState(monthFromUrl);
  const [showUnused, setShowUnused] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null); // the category whose transactions are showing
  const [editing, setEditing] = useState<Entry | null>(null);
  const { data: b, isLoading } = useQuery({ queryKey: ["budget", month], queryFn: () => api<Budget>(`/api/budgets/${month}`), placeholderData: (p) => p });
  const history = useQuery({ queryKey: ["budget-history"], queryFn: () => api<History[]>("/api/budgets?months=12") });
  const save = useAction((body: object) => api<Budget>(`/api/budgets/${month}`, { method: "PUT", body }));
  useEffect(() => setOpenCat(null), [month]);

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
  const groups = BUCKETS.map((g) => {
    const list = rows.filter((c) => c.bucket === g.key);
    return { ...g, rows: list, budget: list.reduce((n, c) => n + c.budgeted_spending, 0), actual: list.reduce((n, c) => n + c.actual_spending, 0) };
  }).filter((g) => g.rows.length);
  const last = `${month}-${String(view.daysInMonth).padStart(2, "0")}`;
  const from = `${month}-01`;
  const incomeLeft = b.expected_income - b.actual_income;
  const segs = [...stack.map((c) => ({ color: c.color, value: c.actual_spending })), ...(b.uncategorized_spending > 0.005 ? [{ color: "#d4d4d8", value: b.uncategorized_spending }] : [])];
  const catRow = (c: BudgetCategory) => (
    <CatRow key={c.category_id} name={c.name} color={c.color} icon={c.lucide_icon} spent={c.actual_spending} budget={c.budgeted_spending} left={c.budgeted_spending - c.actual_spending}
      cur={cur} open={openCat === c.category_id} onToggle={() => setOpenCat(openCat === c.category_id ? null : c.category_id)} onSave={setCat(c.category_id)}>
      <CategoryTransactions categoryId={c.category_id} from={from} to={last} onEdit={setEditing} />
    </CatRow>
  );

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

      {/* the month at a glance */}
      <section className="card px-6 py-8 sm:px-10">
        <div className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:gap-14">
          <div className="relative mx-auto flex w-fit items-center justify-center">
            <Ring segments={segs} scale={scale} size={220} />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="text-[13px] text-zinc-500">Spent</div>
              <div className={cx("mt-1 text-[28px] font-semibold leading-none tabular-nums tracking-tight", over ? "text-rose-600" : "text-zinc-900")}>{f0(b.actual_spending)}</div>
              <div className="mt-3 flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[13px] text-zinc-600">
                of <span className="text-zinc-400">{cur}</span>
                <InlineAmount fit className="!px-0.5 !text-left font-medium text-zinc-900" label="Total monthly budget" value={total} onSave={(n) => save.mutate({ budgeted_spending: n })} />
              </div>
            </div>
          </div>

          <div className="text-center md:text-left">
            <div className="eyebrow">{total <= 0 ? "No budget set" : over ? "Over budget by" : "Left to budget"}</div>
            <div className={cx("mt-1 text-[40px] font-semibold leading-none tabular-nums tracking-tight", over ? "text-red-600" : "text-zinc-900")}>{f0(Math.abs(remaining))}</div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start">
              {status.label !== "Over budget" && <span className={cx("rounded-full px-3 py-1 text-xs font-medium", tone)}>{status.label}</span>}
              {view.isCurrent && total > 0 && remaining > 0 && <span className="chip">{f0(remaining / view.daysLeft)} a day for {view.daysLeft} days</span>}
              {view.isCurrent && total > 0 && view.projected > total && <span className="chip !text-amber-600">On pace for {f0(view.projected)}</span>}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-zinc-100 pt-4 text-[14px] md:justify-start">
              <span className="muted">Income</span>
              <span className="font-semibold tabular-nums">{f0(b.actual_income)}</span>
              <span className="muted">earned of</span>
              <InlineAmount fit className="!px-1 !py-0 text-[14px] !text-zinc-500" label="Expected income" value={b.expected_income} onSave={(n) => save.mutate({ expected_income: n })} />
              <span className="muted">expected</span>
              {b.expected_income > 0 && <span className={cx("text-xs", incomeLeft > 0.5 ? "muted" : "text-emerald-600")}>· {incomeLeft > 0.5 ? `${f0(incomeLeft)} to go` : "on target"}</span>}
            </div>
          </div>
        </div>
        <ErrorNote error={save.error} />
      </section>

      {/* where it went: click a category to see its transactions */}
      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="section-title">Spending by category</h2>
          <span className="muted hidden text-xs sm:block">Click a category to see what is in it</span>
        </div>
        {groups.length === 0 && b.uncategorized_spending <= 0.005 && <p className="muted px-7 py-10 text-center text-sm">Nothing budgeted or spent yet this month.</p>}
        {groups.map((g) => (
          <div key={g.key}>
            {groups.length > 1 && (
              <div className="flex items-baseline justify-between border-t border-zinc-100 bg-soft/40 px-5 py-2.5 first:border-t-0 sm:px-7">
                <h3 className="eyebrow" title={g.hint}>{g.label}</h3>
                <span className="muted text-xs tabular-nums">{f0(g.actual)} of {f0(g.budget)}</span>
              </div>
            )}
            <ul className="divide-y divide-zinc-100">{g.rows.map(catRow)}</ul>
          </div>
        ))}
        {b.uncategorized_spending > 0.005 && (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
            <CatRow name="Uncategorized" color="#9ca3af" icon={null} spent={b.uncategorized_spending} cur={cur} open={openCat === "none"} onToggle={() => setOpenCat(openCat === "none" ? null : "none")}>
              <CategoryTransactions categoryId={null} from={from} to={last} onEdit={setEditing} />
            </CatRow>
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-5 py-3.5 text-[13px] sm:px-7">
          {unused.length > 0 ? (
            <button className="font-medium text-accent hover:underline" onClick={() => setShowUnused(!showUnused)}>
              {showUnused ? "Hide unused categories" : `Show ${unused.length} unused categor${unused.length === 1 ? "y" : "ies"}`}
            </button>
          ) : <span />}
          {total > 0 && Math.abs(b.unallocated_spending) >= 0.5 && <span className="muted">{f0(Math.abs(b.unallocated_spending))} {b.unallocated_spending > 0 ? "of the total isn't split into categories" : "over the total budget"}</span>}
        </div>
      </section>

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
      {editing && <TransactionModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
