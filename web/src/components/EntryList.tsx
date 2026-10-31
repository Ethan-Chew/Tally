import { api, type Entry } from "../api";
import { useAction } from "../hooks";
import { cx, fmtDate, money } from "../lib";
import { categoryIconName, Icon } from "./Icon";
import { CatBadge } from "./ui";

/** Positive amount = outflow (shown with a minus, red); negative amount = inflow (shown with a plus, green). */
export function Amount({ amount, currency, className, neutral }: { amount: number; currency: string; className?: string; neutral?: boolean }) {
  const inflow = amount < 0;
  return (
    <span className={cx("tabular-nums", neutral ? "text-zinc-500" : inflow ? "text-emerald-600" : amount > 0 ? "text-rose-600" : "", className)}>
      {inflow ? "+" : amount > 0 ? "−" : ""}
      {money(Math.abs(amount), currency)}
    </span>
  );
}

function title(e: Entry) {
  if (e.entryable_type === "Account::Valuation") return e.name;
  if (e.entryable_type === "Account::Trade") return `${e.amount > 0 ? "Buy" : "Sell"} ${Math.abs(e.qty ?? 0)} ${e.ticker ?? ""}${e.price ? ` @ ${money(e.price, e.currency)}` : ""}`;
  return e.name;
}

function Badge({ e }: { e: Entry }) {
  if (e.entryable_type === "Account::Valuation") return <span className="icon-circle"><Icon name="edit" /></span>;
  if (e.entryable_type === "Account::Trade") return <span className="icon-circle"><Icon name="trend" /></span>;
  return <CatBadge name={e.category_name} color={e.category_color} icon={e.category_icon} transfer={!!e.transfer_id} />;
}

function CategoryPill({ e }: { e: Entry }) {
  if (e.entryable_type !== "Account::Transaction") return null;
  if (e.transfer_id) return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-soft px-3 py-1 text-xs font-medium text-zinc-600"><Icon name="swap" className="h-3.5 w-3.5" />Transfer</span>;
  if (!e.category_name) return <span className="inline-flex items-center rounded-full bg-soft px-3 py-1 text-xs font-medium text-zinc-500">Uncategorized</span>;
  const c = e.category_color ?? "#9ca3af";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium text-zinc-700" style={{ background: `${c}1f` }}>
      <span style={{ color: c }}><Icon name={categoryIconName(e.category_icon, e.category_name)} className="h-3.5 w-3.5" /></span>
      {e.category_name}
    </span>
  );
}

export function EntryList({
  entries, showAccount = true, selected, onSelect, onEdit,
}: {
  entries: Entry[]; showAccount?: boolean; selected?: Set<string>; onSelect?: (id: string, on: boolean) => void; onEdit: (e: Entry) => void;
}) {
  const confirm_ = useAction((id: string) => api(`/api/transfers/${id}/confirm`, { method: "POST" }));
  const unlink = useAction((id: string) => api(`/api/transfers/${id}/unlink`, { method: "POST" }));

  // group by day (entries already arrive newest-first)
  const groups: { date: string; rows: Entry[] }[] = [];
  for (const e of entries) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.rows.push(e); else groups.push({ date: e.date, rows: [e] });
  }

  return (
    <div className="space-y-1 p-2 sm:p-3">
      {groups.map((g) => {
        const spendRows = g.rows.filter((e) => e.entryable_type === "Account::Transaction" && !e.transfer_id && !e.excluded);
        const sameCur = spendRows.length > 0 && spendRows.every((e) => e.currency === spendRows[0]!.currency);
        const net = spendRows.reduce((s, e) => s + e.amount, 0);
        const allSelected = !!onSelect && g.rows.every((e) => selected?.has(e.id));
        return (
          <div key={g.date} className="pb-3">
            <div className="flex items-center gap-3 rounded-xl bg-soft/70 px-3 py-2.5 sm:px-4">
              {onSelect && <input type="checkbox" aria-label={`Select all on ${g.date}`} checked={allSelected} onChange={(ev) => g.rows.forEach((e) => onSelect(e.id, ev.target.checked))} />}
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{fmtDate(g.date, { month: "long", day: "numeric", year: "numeric" })}</span>
              <span className="text-[11px] text-zinc-400">· {g.rows.length}</span>
              {sameCur && <Amount amount={net} currency={spendRows[0]!.currency} neutral className="ml-auto text-xs font-medium" />}
            </div>
            <ul>
              {g.rows.map((e) => (
                <li key={e.id}>
                  <div role="button" tabIndex={0}
                    onClick={() => (e.entryable_type === "Account::Transaction" || e.entryable_type === "Account::Valuation") && onEdit(e)}
                    onKeyDown={(ev) => ev.key === "Enter" && onEdit(e)}
                    className={cx("flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-3.5 transition hover:bg-soft sm:gap-4 sm:px-4", e.excluded && "opacity-50")}>
                    {onSelect && (
                      <span onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${e.name}`} checked={selected?.has(e.id) ?? false} onChange={(ev) => onSelect(e.id, ev.target.checked)} />
                      </span>
                    )}
                    <Badge e={e} />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 break-words text-[14px] font-medium sm:truncate">{title(e)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <span className="truncate">{[e.merchant_name, showAccount ? e.account_name : null].filter(Boolean).join(" · ") || (e.entryable_type === "Account::Valuation" ? "Balance update" : "")}</span>
                        {e.excluded && <span className="pill bg-soft text-zinc-600">Excluded</span>}
                        {e.tags.map((t) => <span key={t.id} className="pill text-white" style={{ background: t.color }}>{t.name}</span>)}
                        {e.transfer_id && e.transfer_status === "pending" && (
                          <span className="inline-flex items-center gap-2" onClick={(ev) => ev.stopPropagation()}>
                            <span className="pill bg-amber-50 text-amber-700">Transfer?</span>
                            <button className="font-medium text-emerald-600 hover:underline" onClick={() => confirm_.mutate(e.transfer_id!)}>Confirm</button>
                            <button className="hover:underline" onClick={() => unlink.mutate(e.transfer_id!)}>Not a transfer</button>
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 sm:hidden"><CategoryPill e={e} /></div>
                    </div>
                    <div className="hidden w-44 shrink-0 sm:block"><CategoryPill e={e} /></div>
                    <div className="w-24 shrink-0 text-right text-[13px] font-semibold sm:w-32 sm:text-[14px]">
                      {e.entryable_type === "Account::Valuation" ? <span className="tabular-nums">{money(e.amount, e.currency)}</span> : <Amount amount={e.amount} currency={e.currency} neutral={!!e.transfer_id} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
