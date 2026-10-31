import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Empty, PageSkeleton } from "../components/ui";
import { cx, fmtDate, money, todayStr } from "../lib";

interface Item {
  key: string; name: string; direction: "expense" | "income"; cadence: string; amount: number; monthly: number; count: number;
  first_date: string; last_date: string; next_due: string; active: boolean; history: { date: string; amount: number }[];
}
interface Resp { currency: string; monthly_expenses: number; monthly_income: number; items: Item[] }

const CADENCE: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const HIDDEN_KEY = "recurring:hidden";

// "not recurring" is a view preference, so it lives in this browser rather than in the database
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); } catch { return []; } };
const writeHidden = (keys: string[]) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(keys)); } catch { /* private mode */ } };

const daysUntil = (date: string) => Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(todayStr() + "T00:00:00Z")) / 86400000);
const when = (date: string) => {
  const n = daysUntil(date);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 1 && n < 7 ? `In ${n} days` : n < 0 ? `${-n} days overdue` : fmtDate(date, { day: "numeric", month: "short" });
};

export default function RecurringPage() {
  const q = useQuery({ queryKey: ["recurring"], queryFn: () => api<Resp>("/api/recurring"), staleTime: 60_000 });
  const [hidden, setHidden] = useState(readHidden);
  const [open, setOpen] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  if (!q.data) return <PageSkeleton />;
  const cur = q.data.currency;

  const hide = (key: string, on: boolean) => {
    const next = on ? [...hidden, key] : hidden.filter((k) => k !== key);
    setHidden(next);
    writeHidden(next);
  };
  const visible = q.data.items.filter((i) => !hidden.includes(i.key));
  const active = visible.filter((i) => i.active);
  const ended = visible.filter((i) => !i.active);
  const expenses = active.filter((i) => i.direction === "expense");
  const income = active.filter((i) => i.direction === "income");
  const monthlyOut = expenses.reduce((s, i) => s + i.monthly, 0);
  const monthlyIn = income.reduce((s, i) => s + i.monthly, 0);
  const next30 = expenses.filter((i) => daysUntil(i.next_due) <= 30);
  const hiddenItems = q.data.items.filter((i) => hidden.includes(i.key));

  const row = (i: Item) => (
    <li key={i.key}>
      <button onClick={() => setOpen(open === i.key ? "" : i.key)} aria-expanded={open === i.key} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-soft sm:px-7">
        <span className="icon-circle"><Icon name={i.direction === "income" ? "arrowDown" : "swap"} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{i.name}</div>
          <div className="muted mt-0.5 text-xs">{CADENCE[i.cadence]} · {i.active ? `next ${when(i.next_due)}` : `last ${fmtDate(i.last_date)}`}</div>
        </div>
        <div className="text-right">
          <div className={cx("text-[14px] font-semibold tabular-nums", i.direction === "income" && "text-emerald-600")}>{i.direction === "income" ? "+" : ""}{money(i.amount, cur)}</div>
          {i.cadence !== "monthly" && <div className="muted text-xs tabular-nums">≈ {money(i.monthly, cur)} /mo</div>}
        </div>
      </button>
      {open === i.key && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 text-sm sm:px-7">
          <div className="eyebrow mb-2">Recent</div>
          <ul className="space-y-1.5">
            {i.history.slice(0, 6).map((h) => <li key={h.date} className="flex justify-between"><span className="muted">{fmtDate(h.date)}</span><span className="tabular-nums">{money(h.amount, cur)}</span></li>)}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <span className="muted text-xs">{i.count} charges since {fmtDate(i.first_date, { month: "short", year: "numeric" })}</span>
            <button className="btn" onClick={() => hide(i.key, true)}>Not recurring</button>
          </div>
        </div>
      )}
    </li>
  );

  const section = (title: string, list: Item[], total?: number) => list.length > 0 && (
    <section className="card overflow-hidden">
      <div className="card-head"><h2 className="section-title">{title}</h2>{total !== undefined && <span className="text-[18px] font-semibold tabular-nums">{money(total, cur, { maximumFractionDigits: 0 })}<span className="muted text-xs font-normal"> /mo</span></span>}</div>
      <ul className="divide-y divide-zinc-100">{list.map(row)}</ul>
    </section>
  );

  return (
    <div className="space-y-8 sm:space-y-10">
      <div><h1 className="page-title">Recurring</h1></div>

      <section className="card grid grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-zinc-100">
        {[
          { label: "Bills / month", value: money(monthlyOut, cur, { maximumFractionDigits: 0 }) },
          { label: "Income / month", value: money(monthlyIn, cur, { maximumFractionDigits: 0 }) },
          { label: "Due in 30 days", value: money(next30.reduce((s, i) => s + i.amount, 0), cur, { maximumFractionDigits: 0 }), hint: `${next30.length} bill${next30.length === 1 ? "" : "s"}` },
          { label: "Share of income", value: monthlyIn > 0 ? `${Math.round((monthlyOut / monthlyIn) * 100)}%` : "—" },
        ].map((s, i) => (
          <div key={s.label} className={cx("px-5 py-5 sm:px-7", i >= 2 && "border-t border-zinc-100 lg:border-t-0")}>
            <div className="eyebrow">{s.label}</div>
            <div className="stat mt-1.5">{s.value}</div>
            {s.hint && <div className="muted mt-1 text-xs">{s.hint}</div>}
          </div>
        ))}
      </section>

      {!visible.length ? <Empty>No repeating charges found yet. They show up after three matching payments.</Empty> : (
        <>
          {section("Bills and subscriptions", expenses.sort((a, b) => a.next_due.localeCompare(b.next_due)), monthlyOut)}
          {section("Recurring income", income, monthlyIn)}
          {ended.length > 0 && (
            <div className="text-center">
              <button className="muted text-xs underline" onClick={() => setShowEnded(!showEnded)}>{showEnded ? "Hide" : "Show"} {ended.length} that look stopped</button>
            </div>
          )}
          {showEnded && section("Looks like these stopped", ended)}
        </>
      )}

      {hiddenItems.length > 0 && (
        <div className="text-center">
          <button className="muted text-xs underline" onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Hide" : "Show"} {hiddenItems.length} ignored</button>
          {showHidden && (
            <ul className="mx-auto mt-3 max-w-md space-y-2 text-sm">
              {hiddenItems.map((i) => <li key={i.key} className="flex items-center justify-between"><span>{i.name}</span><button className="btn" onClick={() => hide(i.key, false)}>Restore</button></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
