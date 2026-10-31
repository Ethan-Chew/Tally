import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs, type Budget, type Dashboard as Dash } from "../api";
import { Amount } from "../components/EntryList";
import { useAccounts } from "../hooks";
import { TransactionModal, TransferModal } from "../components/EntryForms";
import { Icon } from "../components/Icon";
import { BigMoney, CatBadge, Dot, Empty, PageSkeleton, Pills, Progress, Skeleton } from "../components/ui";
import { currentMonth, cx, fmtDate, money, monthLabel, TYPE_ICONS, TYPE_LABELS } from "../lib";

const PERIODS = [
  { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" }, { value: "365d", label: "1Y" }, { value: "all", label: "All" },
];

function CardHead({ title, sub, to, link }: { title: string; sub?: string; to?: string; link?: string }) {
  return (
    <div className="card-head">
      <div>
        <h2 className="section-title">{title}</h2>
        {sub && <p className="card-sub">{sub}</p>}
      </div>
      {to && <Link to={to} className="icon-btn" aria-label={link ?? "View all"} title={link ?? "View all"}><Icon name="chevronRight" /></Link>}
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState("30d");
  const [modal, setModal] = useState<"txn" | "transfer" | null>(null);
  const qc = useQueryClient();
  const fetchPeriod = (p: string) => api<Dash>(`/api/dashboard${qs({ period: p })}`);
  const dash = useQuery({ queryKey: ["dashboard", period], queryFn: () => fetchPeriod(period), placeholderData: keepPreviousData });
  // warm the other ranges so switching is instant
  useEffect(() => {
    if (!dash.data) return;
    for (const p of PERIODS) qc.prefetchQuery({ queryKey: ["dashboard", p.value], queryFn: () => fetchPeriod(p.value), staleTime: 60_000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!dash.data]);
  const budget = useQuery({ queryKey: ["budget", currentMonth()], queryFn: () => api<Budget>(`/api/budgets/${currentMonth()}`) });
  const d = dash.data;
  // one row per active account, biggest first
  const accountList = [...(useAccounts().data?.accounts ?? [])].filter((a) => a.is_active).sort((x, y) => y.balance_converted - x.balance_converted);
  if (!d) return <PageSkeleton />;
  const switching = dash.isPlaceholderData;
  const cur = d.currency;
  const base = d.net_worth.current - d.net_worth.change;
  const pct = base !== 0 ? (d.net_worth.change / Math.abs(base)) * 100 : 0;
  const up = d.net_worth.change >= 0;
  const spendTotal = d.spending_by_category.reduce((s, c) => s + c.amount, 0);
  const b = budget.data;

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Home</h1>
        </div>
        <Pills value={period} options={PERIODS} onChange={setPeriod} />
      </div>

      <div className="-mt-2 flex items-center gap-2.5">
        <button className="btn btn-primary" onClick={() => setModal("txn")}><Icon name="plus" className="h-4 w-4" />Add</button>
        <button className="icon-btn" onClick={() => setModal("transfer")} aria-label="Transfer" title="Transfer"><Icon name="swap" /></button>
        <Link to="/settings/import" className="icon-btn" aria-label="Import CSV" title="Import CSV"><Icon name="import" /></Link>
        <Link to="/calendar" className="icon-btn" aria-label="Calendar" title="Calendar"><Icon name="calendar" /></Link>
      </div>

      <section className={cx("card transition-opacity", switching && "opacity-60")}>
        <div className="px-5 pt-6 sm:px-7 sm:pt-7">
          <div className="eyebrow">Net worth</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="hero-num"><BigMoney value={d.net_worth.current} currency={cur} /></div>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-medium tabular-nums", up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
              {up ? "+" : "−"}{money(Math.abs(d.net_worth.change), cur)}{Number.isFinite(pct) && pct !== 0 ? ` · ${Math.abs(pct).toFixed(1)}%` : ""}
            </span>
          </div>
        </div>
        <div className="mt-4 h-60 px-2">
          {d.series.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.series} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5266eb" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#5266eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={(v) => fmtDate(v, { day: "numeric", month: "short" })} tick={{ fontSize: 11, fill: "var(--chart-axis)" }} minTickGap={48} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip formatter={(v) => money(Number(v), cur)} labelFormatter={(l) => fmtDate(String(l))} contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" }} />
                <Area isAnimationActive={false} type="monotone" dataKey="net_worth" name="Net worth" stroke="#5266eb" strokeWidth={2} fill="url(#nw)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty>Not enough history yet.</Empty>}
        </div>
        <div className="grid grid-cols-1 divide-y divide-zinc-100 border-t border-zinc-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { label: "Assets", value: money(d.net_worth.assets, cur) },
            { label: "Liabilities", value: money(d.net_worth.liabilities, cur) },
            { label: "Net flow", value: money(d.cashflow.income - d.cashflow.expenses, cur) },
          ].map((s) => (
            <div key={s.label} className="px-5 py-5 sm:px-7">
              <div className="eyebrow">{s.label}</div>
              <div className="stat mt-1.5">{s.value}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <CardHead title="Spending" to="/calendar" link="Open calendar" />
          <div className="card-body">
            <div className="mb-6 grid grid-cols-2 gap-6">
              <div><div className="eyebrow">Spent</div><div className="stat mt-1">{money(d.cashflow.expenses, cur, { maximumFractionDigits: 0 })}</div></div>
              <div><div className="eyebrow">Income</div><div className="stat mt-1">{money(d.cashflow.income, cur, { maximumFractionDigits: 0 })}</div></div>
            </div>
            {spendTotal > 0 ? (
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="mx-auto h-40 w-40 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie isAnimationActive={false} data={d.spending_by_category} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2} stroke="none">
                        {d.spending_by_category.map((c) => <Cell key={c.category_id ?? "none"} fill={c.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => money(Number(v), cur)} contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid var(--chart-line)", boxShadow: "none", background: "var(--color-white)", color: "var(--color-zinc-900)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 flex-1 space-y-3 text-sm">
                  {d.spending_by_category.slice(0, 6).map((c) => (
                    <li key={c.category_id ?? "none"} className="flex items-center gap-3">
                      <CatBadge size="sm" name={c.name} color={c.color} icon={c.icon} /><span className="truncate">{c.name}</span>
                      <span className="muted ml-auto tabular-nums">{Math.round((c.amount / spendTotal) * 100)}%</span>
                      <span className="w-20 text-right font-medium tabular-nums">{money(c.amount, cur, { maximumFractionDigits: 0 })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <Empty>No spending in this period.</Empty>}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <CardHead title={`Budget · ${monthLabel(currentMonth()).split(" ")[0]}`} to="/budgets" link="Budgets" />
          <div className="card-body">
            {!b ? <Skeleton className="h-24 w-full" /> : b.budgeted_spending > 0 ? (
              <div className="space-y-4">
                <div>
                  <div className="eyebrow">Spent this month</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={cx("stat", b.actual_spending > b.budgeted_spending && "!text-red-600")}>{money(b.actual_spending, cur, { maximumFractionDigits: 0 })}</span>
                    <span className="muted text-sm">of {money(b.budgeted_spending, cur, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                <Progress value={b.actual_spending} max={b.budgeted_spending} />
                <p className="muted text-sm">
                  {b.budgeted_spending >= b.actual_spending
                    ? `${money(b.budgeted_spending - b.actual_spending, cur, { maximumFractionDigits: 0 })} left`
                    : `${money(b.actual_spending - b.budgeted_spending, cur, { maximumFractionDigits: 0 })} over budget`}
                </p>
              </div>
            ) : <Empty>No budget set for this month. <Link className="font-medium text-accent hover:underline" to="/budgets">Set one</Link></Empty>}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-2">
          <CardHead title="Accounts" to="/accounts" link="Accounts" />
          <ul className="divide-y divide-zinc-100">
            {accountList.map((a) => (
              <li key={a.id}>
                <Link to={`/accounts/${a.id}`} className="flex items-center gap-3.5 px-5 py-4 text-sm hover:bg-soft sm:px-7">
                  <span className="icon-circle"><Icon name={TYPE_ICONS[a.accountable_type] ?? "accounts"} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.name}</div>
                    <div className="muted mt-0.5 truncate text-xs">{a.subtype ? a.subtype.replace(/_/g, " ") : TYPE_LABELS[a.accountable_type] ?? a.accountable_type}</div>
                  </div>
                  <div className="text-right">
                    <div className={cx("font-semibold", a.classification === "liability" && "text-rose-600")}>
                      {a.classification === "liability" ? "−" : ""}<BigMoney value={a.balance} currency={a.currency} />
                    </div>
                    {a.currency !== cur && <div className="muted mt-0.5 text-xs">≈ {money(a.balance_converted, cur)}</div>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="card lg:col-span-3">
          <CardHead title="Recent" to="/transactions" link="All transactions" />
          <ul className="divide-y divide-zinc-100">
            {d.recent.map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-5 py-4 sm:px-7">
                <CatBadge name={r.category_name} color={r.category_color} icon={r.category_icon} transfer={r.is_transfer} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{r.name}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-soft px-2 py-0.5 font-medium text-zinc-700">
                      {r.is_transfer ? <Icon name="swap" className="h-3 w-3" /> : <Dot color={r.category_color} />}
                      {r.is_transfer ? "Transfer" : r.category_name ?? "Uncategorized"}
                    </span>
                    <span className="truncate">{fmtDate(r.date, { day: "numeric", month: "short" })} · {r.account_name}</span>
                  </div>
                </div>
                <Amount amount={r.amount} currency={r.currency} neutral={r.is_transfer} className="shrink-0 text-[14px] font-semibold" />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {modal === "txn" && <TransactionModal onClose={() => setModal(null)} />}
      {modal === "transfer" && <TransferModal onClose={() => setModal(null)} />}
      {modal === "txn" && <TransactionModal onClose={() => setModal(null)} />}
      {modal === "transfer" && <TransferModal onClose={() => setModal(null)} />}
    </div>
  );
}
