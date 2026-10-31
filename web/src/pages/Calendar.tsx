import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs, type EntriesResponse } from "../api";
import { Amount } from "../components/EntryList";
import { Icon } from "../components/Icon";
import { CatBadge, Empty, PageSkeleton, Spinner } from "../components/ui";
import { currentMonth, cx, fmtDate, money, monthLabel, todayStr } from "../lib";
import { isHidden, MASK } from "../privacy";

interface Day { date: string; spent: number; income: number; count: number; categories: { name: string; color: string; icon: string | null; amount: number }[] }
interface Cal {
  month: string; prev_month: string; next_month: string; currency: string; days: Day[];
  total_spent: number; total_income: number; spend_days: number; biggest_day: { date: string; spent: number } | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const short = (n: number) => (isHidden() ? MASK : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(n % 1 ? 1 : 0));

export default function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<string>("");
  const cal = useQuery({ queryKey: ["calendar", month], queryFn: () => api<Cal>(`/api/calendar/${month}`), placeholderData: (p) => p });
  const data = cal.data;
  const today = todayStr();

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const max = useMemo(() => Math.max(0, ...(data?.days ?? []).map((d) => d.spent)), [data]);

  // pick a sensible day whenever the month changes: today, else the biggest spending day, else the 1st
  useEffect(() => {
    if (!data || data.month !== month) return;
    setSelected((cur) => {
      if (cur.startsWith(month)) return cur;
      if (today.startsWith(month)) return today;
      return data.biggest_day?.date ?? `${month}-01`;
    });
  }, [data, month, today]);

  const dayEntries = useQuery({
    queryKey: ["entries", "day", selected],
    queryFn: () => api<EntriesResponse>(`/api/entries${qs({ from: selected, to: selected, per_page: 100 })}`),
    enabled: !!selected,
  });

  if (!data) return <PageSkeleton />;
  const cur = data.currency;

  // build the 7-column grid, Monday first
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);

  const elapsed = today.startsWith(month) ? Number(today.slice(8)) : today < month + "-01" ? 0 : daysInMonth;
  const avg = elapsed > 0 ? data.total_spent / elapsed : 0;
  const noSpend = Math.max(0, elapsed - data.spend_days);
  const sel = byDate.get(selected);

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Calendar</h1>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1">
          <button className="icon-btn !h-8 !w-8" onClick={() => setMonth(data.prev_month)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
          <div className="min-w-36 text-center text-sm font-medium">{monthLabel(month)}</div>
          <button className="icon-btn !h-8 !w-8" onClick={() => setMonth(data.next_month)} aria-label="Next month"><Icon name="chevronRight" /></button>
        </div>
      </div>

      <section className="card grid grid-cols-2 divide-zinc-100 lg:grid-cols-4 lg:divide-x">
        {[
          { label: "Spent", value: money(data.total_spent, cur, { maximumFractionDigits: 0 }) },
          { label: "Avg / day", value: money(avg, cur, { maximumFractionDigits: 0 }), hint: elapsed ? `over ${elapsed} day${elapsed === 1 ? "" : "s"}` : "" },
          { label: "Biggest day", value: data.biggest_day ? money(data.biggest_day.spent, cur, { maximumFractionDigits: 0 }) : "—", hint: data.biggest_day ? fmtDate(data.biggest_day.date, { day: "numeric", month: "short" }) : "" },
          { label: "No-spend days", value: String(noSpend), hint: elapsed ? `of ${elapsed}` : "" },
        ].map((s, i) => (
          <div key={s.label} className={cx("px-5 py-5 sm:px-7", i >= 2 && "border-t border-zinc-100 lg:border-t-0")}>
            <div className="eyebrow">{s.label}</div>
            <div className="stat mt-1.5">{s.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50/60">
            {WEEKDAYS.map((w) => <div key={w} className="px-2 py-3 text-center text-xs font-medium text-zinc-500 sm:px-3 sm:text-left">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              if (!date) return <div key={`b${i}`} className="min-h-[76px] border-b border-r border-zinc-100 bg-zinc-50/40 sm:min-h-[96px]" />;
              const d = byDate.get(date);
              const isSel = date === selected;
              const isToday = date === today;
              const future = date > today;
              const heat = d && max > 0 ? 0.04 + (d.spent / max) * 0.22 : 0;
              return (
                <button
                  key={date}
                  onClick={() => setSelected(date)}
                  aria-label={`${fmtDate(date)}: ${d?.spent ? money(d.spent, cur) + " spent" : "no spending"}`}
                  aria-pressed={isSel}
                  className={cx(
                    "relative flex min-h-[76px] flex-col items-stretch border-b border-r border-zinc-100 p-1.5 text-left transition hover:bg-zinc-50 sm:min-h-[96px] sm:p-2.5",
                    isSel && "z-10 ring-2 ring-inset ring-accent",
                    future && "opacity-50",
                  )}
                  style={heat ? { backgroundColor: `rgba(82,102,235,${heat})` } : undefined}
                >
                  <span className={cx("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium", isToday ? "bg-zinc-900 text-white" : "text-zinc-600")}>{Number(date.slice(8))}</span>
                  {d && d.spent > 0 && (
                    <span className="mt-auto">
                      <span className="block text-[13px] font-semibold tabular-nums leading-tight">{short(d.spent)}</span>
                      <span className="mt-1.5 hidden gap-1 sm:flex">
                        {d.categories.slice(0, 4).map((c) => <span key={c.name} title={`${c.name}: ${money(c.amount, cur)}`} className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card self-start">
          <div className="card-head">
            <div>
              <h2 className="section-title">{selected ? fmtDate(selected, { weekday: "long", day: "numeric", month: "long" }) : "Pick a day"}</h2>
            </div>
          </div>
          <div className="space-y-6 px-5 py-6 sm:px-7">
            <div>
              <div className="eyebrow">Spent</div>
              <div className="stat mt-1">{money(sel?.spent ?? 0, cur)}</div>
              {!!sel?.income && <div className="mt-1 text-sm text-emerald-600">+{money(sel.income, cur)} income</div>}
            </div>

            {sel && sel.categories.length > 0 && (
              <div>
                <div className="eyebrow mb-3">On what</div>
                <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-zinc-100">
                  {sel.categories.map((c) => <div key={c.name} style={{ width: `${(c.amount / sel.spent) * 100}%`, background: c.color }} />)}
                </div>
                <ul className="space-y-2.5 text-sm">
                  {sel.categories.map((c) => (
                    <li key={c.name} className="flex items-center gap-2.5"><CatBadge size="xs" name={c.name} color={c.color} icon={c.icon} /><span className="truncate">{c.name}</span><span className="ml-auto font-medium tabular-nums">{money(c.amount, cur)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-100">
            <div className="eyebrow px-5 pb-2 pt-5 sm:px-7">Transactions</div>
            {dayEntries.isLoading ? <Spinner /> : !dayEntries.data?.rows.length ? <Empty>Nothing on this day.</Empty> : (
              <ul className="divide-y divide-zinc-100">
                {dayEntries.data.rows.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-4 sm:px-7 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{e.name}</div>
                      <div className="muted mt-0.5 flex items-center gap-1.5 truncate text-xs">
                        {e.category_name ? <><CatBadge size="xs" name={e.category_name} color={e.category_color} icon={e.category_icon} />{e.category_name}</> : "Uncategorized"} · {e.account_name}{e.transfer_id ? " · Transfer" : ""}
                      </div>
                    </div>
                    <Amount amount={e.amount} currency={e.currency} className="shrink-0 font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
