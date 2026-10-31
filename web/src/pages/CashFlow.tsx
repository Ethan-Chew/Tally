import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { api, qs } from "../api";
import { CatBadge, Empty, PageSkeleton, Pills } from "../components/ui";
import { cx, fmtDate, money, todayStr } from "../lib";

interface Node { id: string; name: string; color: string; icon: string | null; amount: number }
interface Totals { income: number; expenses: number; net: number; savings_rate: number | null }
interface Resp {
  currency: string; from: string; to: string; income: Node[]; expenses: Node[];
  totals: Totals; previous: Totals & { from: string; to: string };
}

type Range = "month" | "last" | "3m" | "6m" | "ytd" | "12m";
const RANGES: { value: Range; label: string }[] = [
  { value: "month", label: "This month" }, { value: "last", label: "Last month" }, { value: "3m", label: "3M" },
  { value: "6m", label: "6M" }, { value: "ytd", label: "YTD" }, { value: "12m", label: "12M" },
];

const iso = (d: Date) => d.toLocaleDateString("en-CA");
function bounds(r: Range): { from: string; to: string } {
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
  }
}

const GREY = "#9ca3af";
const MAX_DESTINATIONS = 9;

/** Keep the diagram readable: the biggest spending categories, the rest folded into one "Other" node. */
function top(list: Node[], max: number): Node[] {
  if (list.length <= max) return list;
  const rest = list.slice(max - 1);
  return [...list.slice(0, max - 1), { id: "other", name: `Other (${rest.length})`, color: GREY, icon: null, amount: rest.reduce((s, n) => s + n.amount, 0) }];
}

/** Sources (income, plus savings drawn down if you spent more than you earned) -> Cash flow -> destinations (spending, plus what was saved). */
function build(d: Resp) {
  const sources = top(d.income, MAX_DESTINATIONS);
  const dests = top(d.expenses, MAX_DESTINATIONS);
  const { income, expenses, net } = d.totals;
  if (net < 0) sources.push({ id: "deficit", name: "From savings", color: GREY, icon: null, amount: -net });
  if (net > 0) dests.push({ id: "saved", name: "Saved", color: "#10b981", icon: null, amount: net });
  const middle: Node = { id: "flow", name: "Cash flow", color: "#5266eb", icon: null, amount: Math.max(income, expenses) };
  const nodes = [...sources, middle, ...dests];
  const mid = sources.length;
  const links = [
    ...sources.map((n, i) => ({ source: i, target: mid, value: n.amount, color: n.color })),
    ...dests.map((n, i) => ({ source: mid, target: mid + 1 + i, value: n.amount, color: n.color })),
  ];
  return { nodes, links, sources: sources.length };
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Delta({ now, before, good }: { now: number; before: number; good: "up" | "down" }) {
  if (!before) return null;
  const change = (now - before) / Math.abs(before);
  if (Math.abs(change) < 0.005) return <span className="muted text-xs">no change</span>;
  const better = good === "up" ? change > 0 : change < 0;
  return <span className={cx("text-xs tabular-nums", better ? "text-emerald-600" : "text-red-600")}>{change > 0 ? "↑" : "↓"} {Math.abs(Math.round(change * 100))}% vs previous</span>;
}

export default function CashFlowPage() {
  const [range, setRange] = useState<Range>("3m");
  const [group, setGroup] = useState<"parent" | "category">("parent");
  const [view, setView] = useState<"flow" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "flow"));
  const { from, to } = useMemo(() => bounds(range), [range]);
  const q = useQuery({ queryKey: ["cashflow", from, to, group], queryFn: () => api<Resp>(`/api/cashflow${qs({ from, to, group })}`), placeholderData: (p) => p });
  const d = q.data;
  const graph = useMemo(() => (d ? build(d) : null), [d]);
  if (!d || !graph) return <PageSkeleton />;
  const cur = d.currency;
  const t = d.totals;
  const empty = !d.income.length && !d.expenses.length;
  // two-line labels need about 54px per node on the busier side, or neighbouring labels collide
  const height = Math.max(420, Math.max(graph.sources, graph.nodes.length - graph.sources - 1) * 54 + 24);

  const list = (title: string, nodes: Node[], total: number) => (
    <section className="card overflow-hidden">
      <div className="card-head"><h2 className="section-title">{title}</h2><span className="text-[16px] font-semibold tabular-nums">{money(total, cur, { maximumFractionDigits: 0 })}</span></div>
      <ul className="divide-y divide-zinc-100">
        {nodes.map((n) => (
          <li key={n.id} className="px-5 py-3.5 sm:px-7">
            <div className="flex items-center gap-3 text-sm">
              <CatBadge size="xs" name={n.name} color={n.color} icon={n.icon} />
              <Link to={`/transactions${qs({ category_id: n.id === "uncategorized" ? undefined : n.id, from, to })}`} className="min-w-0 flex-1 truncate hover:underline">{n.name}</Link>
              <span className="muted text-xs tabular-nums">{total ? Math.round((n.amount / total) * 100) : 0}%</span>
              <span className="w-24 text-right font-medium tabular-nums">{money(n.amount, cur, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${total ? (n.amount / total) * 100 : 0}%`, background: n.color }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Cash flow</h1>
          <p className="muted mt-1 text-sm">{fmtDate(d.from)} – {fmtDate(d.to)}</p>
        </div>
        <div className="max-w-full overflow-x-auto"><Pills value={range} onChange={setRange} options={RANGES} /></div>
      </div>

      <section className="card grid grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-zinc-100">
        {[
          { label: "Income", value: money(t.income, cur, { maximumFractionDigits: 0 }), delta: <Delta now={t.income} before={d.previous.income} good="up" /> },
          { label: "Expenses", value: money(t.expenses, cur, { maximumFractionDigits: 0 }), delta: <Delta now={t.expenses} before={d.previous.expenses} good="down" /> },
          { label: "Net", value: money(t.net, cur, { maximumFractionDigits: 0 }), delta: <Delta now={t.net} before={d.previous.net} good="up" />, tone: t.net < 0 ? "text-red-600" : "text-emerald-600" },
          { label: "Savings rate", value: pct(t.savings_rate), delta: d.previous.savings_rate !== null ? <span className="muted text-xs">{pct(d.previous.savings_rate)} previously</span> : null },
        ].map((s, i) => (
          <div key={s.label} className={cx("px-5 py-5 sm:px-7", i >= 2 && "border-t border-zinc-100 lg:border-t-0")}>
            <div className="eyebrow">{s.label}</div>
            <div className={cx("stat mt-1.5", s.tone)}>{s.value}</div>
            <div className="mt-1 min-h-4">{s.delta}</div>
          </div>
        ))}
      </section>

      {empty ? <Empty>No income or spending in this period.</Empty> : (
        <section className="card overflow-hidden">
          <div className="card-head flex-wrap gap-3">
            <h2 className="section-title">Where it went</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Pills value={group} onChange={setGroup} options={[{ value: "parent", label: "Groups" }, { value: "category", label: "Categories" }]} />
              <Pills value={view} onChange={setView} options={[{ value: "flow", label: "Flow" }, { value: "list", label: "List" }]} />
            </div>
          </div>
          {view === "flow" ? (
            <div className="px-2 py-4 sm:px-4" style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={{ nodes: graph.nodes, links: graph.links }}
                  nodePadding={30}
                  nodeWidth={10}
                  margin={{ top: 12, right: 150, bottom: 24, left: 150 }}
                  link={<FlowLink />}
                  node={<FlowNode sources={graph.sources} currency={cur} total={Math.max(t.income, t.expenses)} />}
                >
                  <Tooltip content={<FlowTip currency={cur} total={Math.max(t.income, t.expenses)} />} />
                </Sankey>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-2">
              {list("Income", d.income, t.income)}
              {list("Expenses", d.expenses, t.expenses)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Recharts hands custom node/link renderers their geometry as props; amounts go through money() so privacy mode masks them.
function FlowLink(p: any) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = p;
  const color = payload?.color ?? GREY;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={Math.max(1, linkWidth)}
    />
  );
}

function FlowNode({ x, y, width, height, index, payload, sources, currency, total }: any) {
  const left = index < sources;
  const middle = index === sources;
  const n = payload as Node;
  const label = money(n.amount, currency, { maximumFractionDigits: 0 });
  const cx = left ? x - 8 : x + width + 8;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(1, height)} rx={3} fill={n.color} />
      {!middle && (
        <text x={cx} y={y + height / 2} textAnchor={left ? "end" : "start"} dominantBaseline="middle" fontSize={12} fill="currentColor">
          <tspan fontWeight={600}>{n.name}</tspan>
          <tspan x={cx} dy={14} fill="var(--chart-axis)">{label}{total ? ` · ${Math.round((n.amount / total) * 100)}%` : ""}</tspan>
        </text>
      )}
    </g>
  );
}

function FlowTip({ active, payload, currency, total }: any) {
  const p = active ? payload?.[0]?.payload : null;
  if (!p) return null;
  // a link carries source/target, a node carries its own name
  const name = p.source && p.target ? `${p.source.name} → ${p.target.name}` : p.name;
  const value = p.value ?? p.amount ?? 0;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-medium">{name}</div>
      <div className="muted mt-0.5 tabular-nums">{money(value, currency)}{total ? ` · ${Math.round((value / total) * 100)}% of flow` : ""}</div>
    </div>
  );
}
