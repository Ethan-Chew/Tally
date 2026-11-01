import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Budget } from "../api";
import { Icon } from "../components/Icon";
import { CatBadge, ErrorNote, PageSkeleton } from "../components/ui";
import type { BudgetCategory } from "../api";
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

const BUCKETS = [
  { key: "fixed", label: "Fixed", hint: "Mostly recurring monthly bills" },
  { key: "flexible", label: "Flexible", hint: "Everything else" },
  { key: "non_monthly", label: "Non-monthly", hint: "Mostly quarterly or yearly bills" },
] as const;

const GRID = "grid grid-cols-[minmax(0,1fr)_88px_84px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_112px_96px_104px] sm:gap-3";

/** What is left of a budget: green while there is some, red when over, grey at zero. */
function Left({ value, cur, income }: { value: number; cur: string; income?: boolean }) {
  const over = value < -0.5, zero = Math.abs(value) < 0.5;
  const good = income ? !zero && value < 0 : !over && !zero; // for income, "negative" means earned more than expected
  const shown = income ? Math.abs(value) : value;
  return (
    <span className={cx("inline-block min-w-[64px] rounded-full px-2.5 py-1 text-center text-[13px] font-medium tabular-nums", zero ? "bg-zinc-100 text-zinc-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
      {income && !zero && value < 0 ? "+" : ""}{money(shown, cur, { maximumFractionDigits: 0 })}
    </span>
  );
}

/** Header over a group of rows: collapsible, with the group's totals. */
function GroupHead({ label, hint, budget, actual, left, open, onToggle, cur, income, children }: { label: string; hint?: string; budget: ReactNode; actual: number; left: number; open?: boolean; onToggle?: () => void; cur: string; income?: boolean; children?: ReactNode }) {
  return (
    <div className={cx(GRID, "bg-soft/60 px-5 py-3 sm:px-7")}>
      <button type="button" onClick={onToggle} aria-expanded={open} disabled={!onToggle} title={hint} className="flex min-w-0 items-center gap-2 text-left text-[15px] font-semibold">
        {onToggle && <Icon name={open ? "chevronDown" : "chevronRight"} className="h-4 w-4 shrink-0 text-zinc-400" />}
        <span className="truncate">{label}</span>{children}
      </button>
      <div className="text-right text-[14px] font-semibold tabular-nums">{budget}</div>
      <div className="hidden text-right text-[14px] font-semibold tabular-nums sm:block">{money(actual, cur, { maximumFractionDigits: 0 })}</div>
      <div className="text-right"><Left value={left} cur={cur} income={income} /></div>
    </div>
  );
}

/** One category: editable budget, what was spent, what is left, and a thin progress line underneath. */
function CatRow({ c, cur, onSave }: { c: BudgetCategory; cur: string; onSave: (n: number) => void }) {
  const left = c.budgeted_spending - c.actual_spending;
  const over = left < 0; // spending with no budget counts as over
  const frac = c.budgeted_spending > 0 ? Math.min(1, c.actual_spending / c.budgeted_spending) : c.actual_spending > 0 ? 1 : 0;
  return (
    <li className="relative">
      <div className={cx(GRID, "px-5 py-3.5 sm:px-7")}>
        <div className="flex min-w-0 items-center gap-3">
          <CatBadge size="xs" name={c.name} color={c.color} icon={c.lucide_icon} />
          <div className="min-w-0">
            <div className="truncate text-[14px]">{c.name}</div>
            <div className="muted text-xs tabular-nums sm:hidden">{money(c.actual_spending, cur, { maximumFractionDigits: 0 })} spent</div>
          </div>
        </div>
        <div className="text-right"><InlineAmount fit className="!w-full rounded-lg !border-zinc-200 !bg-white !py-1.5 text-[14px]" label={`${c.name} budget`} value={c.budgeted_spending} onSave={onSave} /></div>
        <div className="hidden text-right text-[14px] tabular-nums sm:block">{money(c.actual_spending, cur, { maximumFractionDigits: 0 })}</div>
        <div className="text-right"><Left value={left} cur={cur} /></div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-zinc-100"><div className={cx("h-full", over ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${frac * 100}%` }} /></div>
    </li>
  );
}

/** Budget vs. spent for one group, as in the Expenses tab. */
function GroupBar({ label, budget, spent, cur }: { label: string; budget: number; spent: number; cur: string }) {
  const left = budget - spent;
  const frac = budget > 0 ? Math.min(1, spent / budget) : spent > 0 ? 1 : 0;
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex justify-between text-[14px]"><span>{label}</span><span className="muted">{money(budget, cur, { maximumFractionDigits: 0 })} budget</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className={cx("h-full rounded-full", left < 0 ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${frac * 100}%` }} /></div>
      <div className="mt-2 flex justify-between text-[13px] font-medium"><span>{money(spent, cur, { maximumFractionDigits: 0 })} spent</span><span className={left < 0 ? "text-red-600" : "text-emerald-600"}>{money(Math.abs(left), cur, { maximumFractionDigits: 0 })} {left < 0 ? "over" : "remaining"}</span></div>
    </div>
  );
}

export default function Budgets() {
  const [month, setMonth] = useState(monthFromUrl);
  const [showUnused, setShowUnused] = useState(false);
  const [tab, setTab] = useState<"summary" | "income" | "expenses">("expenses");
  const [closed, setClosed] = useState<Set<string>>(new Set()); // collapsed groups
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
  const groups = BUCKETS.map((g) => {
    const list = rows.filter((c) => c.bucket === g.key);
    return { ...g, rows: list, budget: list.reduce((n, c) => n + c.budgeted_spending, 0), actual: list.reduce((n, c) => n + c.actual_spending, 0) };
  }).filter((g) => g.rows.length);
  const toggle = (k: string) => setClosed((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
        {/* left: ring + what is left */}
        <div className="space-y-6 lg:sticky lg:top-6">
          <section className="card px-6 py-10 sm:py-12">
            <div className="relative mx-auto flex w-fit items-center justify-center">
              <Ring segments={segs} scale={scale} />
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-[13px] text-zinc-500">Spent</div>
                <div className={cx("mt-1.5 text-[32px] font-semibold leading-none tabular-nums tracking-tight", over ? "text-rose-600" : "text-zinc-900")}>{money(b.actual_spending, cur, { maximumFractionDigits: 0 })}</div>
                <div className="mt-4 flex items-center gap-1.5 rounded-full bg-soft px-3.5 py-1.5 text-[13px] text-zinc-600">
                  of <span className="text-zinc-400">{cur}</span>
                  <InlineAmount fit className="!px-0.5 !text-left font-medium text-zinc-900" label="Total monthly budget" value={total} onSave={(n) => save.mutate({ budgeted_spending: n })} />
                  <Icon name="edit" className="h-3.5 w-3.5 text-zinc-400" />
                </div>
              </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className={cx("px-6 py-7 text-center", over ? "bg-red-50" : "bg-emerald-50")}>
              <div className={cx("text-[30px] font-semibold tabular-nums tracking-tight", over ? "text-red-700" : "text-emerald-700")}>{money(Math.abs(remaining), cur, { maximumFractionDigits: 0 })}</div>
              <div className={cx("mt-1 text-[14px] font-medium", over ? "text-red-700" : "text-emerald-700")}>{total <= 0 ? "No budget set" : over ? "Over budget" : "Left to budget"}</div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {status.label !== "Over budget" && <span className={cx("rounded-full px-3 py-1 text-xs font-medium", tone)}>{status.label}</span>}
                {view.isCurrent && total > 0 && remaining > 0 && <span className="chip !bg-white/70 !text-zinc-700">{f0(remaining / view.daysLeft)} / day</span>}
                {view.isCurrent && <span className={cx("chip !bg-white/70", total > 0 && view.projected > total ? "!text-amber-600" : "!text-zinc-700")}>→ {f0(view.projected)}</span>}
              </div>
            </div>
            <div className="flex justify-center border-b border-zinc-100 py-3">
              <div className="inline-flex rounded-full bg-soft p-1" role="tablist">
                {([["summary", "Summary"], ["income", "Income"], ["expenses", "Expenses"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-full px-3.5 py-1.5 text-xs font-medium transition", tab === k ? "bg-white text-accent shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>{l}</button>
                ))}
              </div>
            </div>
            {tab === "summary" && (
              <dl className="divide-y divide-zinc-100 text-[14px]">
                {[
                  ["Expected income", f0(b.expected_income)], ["Earned so far", f0(b.actual_income)],
                  ["Budgeted spending", f0(total)], ["Spent so far", f0(b.actual_spending)],
                ].map(([k, v]) => <div key={k} className="flex justify-between px-5 py-3.5 sm:px-6"><dt className="muted">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
              </dl>
            )}
            {tab === "income" && (
              <div className="px-5 py-4 sm:px-6">
                <div className="flex justify-between text-[14px]"><span>Income</span><span className="muted">{f0(b.expected_income)} expected</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${b.expected_income > 0 ? Math.min(100, (b.actual_income / b.expected_income) * 100) : 0}%` }} /></div>
                <div className="mt-2 flex justify-between text-[13px] font-medium"><span>{f0(b.actual_income)} earned</span>{b.expected_income > 0 && <span className="text-emerald-600">{incomeLeft <= 0 ? `${f0(-incomeLeft)} over` : `${f0(incomeLeft)} to go`}</span>}</div>
              </div>
            )}
            {tab === "expenses" && (
              <div className="divide-y divide-zinc-100">
                {groups.map((g) => <GroupBar key={g.key} label={g.label} budget={g.budget} spent={g.actual} cur={cur} />)}
              </div>
            )}
          </section>
          <ErrorNote error={save.error} />
        </div>

        {/* right: the budget table */}
        <section className="card overflow-hidden">
          <div className={cx(GRID, "border-b border-zinc-100 px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:px-7")}>
            <span>Category</span><span className="text-right">Budget</span><span className="hidden text-right sm:block">Actual</span><span className="text-right">Remaining</span>
          </div>

          <GroupHead label="Income" cur={cur} income budget={<InlineAmount fit className="!w-full rounded-lg !border-zinc-200 !bg-white !py-1.5" label="Expected income" value={b.expected_income} onSave={(n) => save.mutate({ expected_income: n })} />} actual={b.actual_income} left={incomeLeft} open={!closed.has("income")} onToggle={() => toggle("income")} />
          {!closed.has("income") && (
            <ul className="divide-y divide-zinc-100">
              {b.income_categories.length === 0 && <li className="muted px-5 py-4 text-sm sm:px-7">No income yet this month.</li>}
              {b.income_categories.map((c) => (
                <li key={c.category_id ?? "none"} className={cx(GRID, "px-5 py-3.5 sm:px-7")}>
                  <div className="flex min-w-0 items-center gap-3"><CatBadge size="xs" name={c.name} color={c.color} icon={c.lucide_icon} /><span className="truncate text-[14px]">{c.name}</span></div>
                  <span className="text-right text-[14px] text-zinc-400">—</span>
                  <span className="text-right text-[14px] font-medium tabular-nums text-emerald-600 sm:text-zinc-900">{money(c.actual, cur, { maximumFractionDigits: 0 })}</span>
                  <span />
                </li>
              ))}
            </ul>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              <GroupHead label={g.label} hint={g.hint} cur={cur} budget={money(g.budget, cur, { maximumFractionDigits: 0 })} actual={g.actual} left={g.budget - g.actual} open={!closed.has(g.key)} onToggle={() => toggle(g.key)} />
              {!closed.has(g.key) && <ul className="divide-y divide-zinc-100">{g.rows.map((c) => <CatRow key={c.category_id} c={c} cur={cur} onSave={setCat(c.category_id)} />)}</ul>}
            </div>
          ))}

          {b.uncategorized_spending > 0.005 && (
            <div className={cx(GRID, "border-t border-zinc-100 px-5 py-3.5 sm:px-7")}>
              <div className="flex items-center gap-3"><CatBadge size="xs" name={null} color="#9ca3af" icon={null} /><span className="text-[14px]">Uncategorized</span></div>
              <span className="text-right text-zinc-400">—</span><span className="hidden text-right text-[14px] tabular-nums sm:block">{f0(b.uncategorized_spending)}</span><span />
            </div>
          )}

          {unused.length > 0 && (
            <button className="w-full border-t border-zinc-100 px-5 py-4 text-left text-[13px] font-medium text-accent hover:bg-tint/50 sm:px-7" onClick={() => setShowUnused(!showUnused)}>
              {showUnused ? "Hide unused categories" : `Show ${unused.length} unused categor${unused.length === 1 ? "y" : "ies"}`}
            </button>
          )}

          <div className={cx(GRID, "border-t border-zinc-200 bg-soft/60 px-5 py-4 sm:px-7")}>
            <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">Total expenses{total > 0 && Math.abs(b.unallocated_spending) >= 0.5 && <span className="chip font-normal">{f0(Math.abs(b.unallocated_spending))} {b.unallocated_spending > 0 ? "unassigned" : "over total"}</span>}</span>
            <div className="text-right"><InlineAmount fit className="!w-full rounded-lg !border-zinc-200 !bg-white !py-1.5 font-semibold" label="Total monthly budget" value={total} onSave={(n) => save.mutate({ budgeted_spending: n })} /></div>
            <span className="hidden text-right text-[14px] font-semibold tabular-nums sm:block">{f0(b.actual_spending)}</span>
            <div className="text-right"><Left value={remaining} cur={cur} /></div>
          </div>
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
