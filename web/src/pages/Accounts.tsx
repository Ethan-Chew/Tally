import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Account } from "../api";
import { Icon } from "../components/Icon";
import { BigMoney, ErrorNote, Field, Modal, PageSkeleton, Sparkline } from "../components/ui";
import { useAccounts, useAction, useMe } from "../hooks";
import { ASSET_TYPES, cx, LIABILITY_TYPES, money, TYPE_ICONS, TYPE_LABELS } from "../lib";

const SUBTYPES: Record<string, string[]> = {
  Depository: ["checking", "savings"],
  Investment: ["brokerage", "retirement", "401k", "ira", "roth_ira", "hsa", "other"],
};

export function AccountRow({ a, currency }: { a: Account; currency: string }) {
  const change = a.balance_30d_ago !== null ? a.balance - a.balance_30d_ago : null;
  const good = change === null || (a.classification === "asset" ? change >= 0 : change <= 0);
  return (
    <Link to={`/accounts/${a.id}`} className={cx("flex items-center gap-4 px-5 py-4 hover:bg-soft sm:px-7", !a.is_active && "opacity-50")}>
      <span className="icon-circle !h-11 !w-11"><Icon name={TYPE_ICONS[a.accountable_type] ?? "accounts"} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{a.name} {!a.is_active && <span className="pill bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Disabled</span>}</div>
        <div className="muted mt-0.5 truncate text-xs">{TYPE_LABELS[a.accountable_type] ?? a.accountable_type}{a.subtype ? ` · ${a.subtype.replace(/_/g, " ")}` : ""}{a.currency !== currency ? ` · ${a.currency}` : ""}</div>
      </div>
      <Sparkline values={a.spark} good={good} className="hidden sm:block" />
      <div className="w-28 text-right sm:w-36">
        <div className="text-[15px] font-semibold"><BigMoney value={a.balance} currency={a.currency} /></div>
        {a.currency !== currency && <div className="muted text-xs tabular-nums">≈ {money(a.balance_converted, currency)}</div>}
      </div>
    </Link>
  );
}

/** One collapsible card per account type, headed by how much the group moved over the last 30 days. */
function Group({ type, list, currency }: { type: string; list: Account[]; currency: string }) {
  const [open, setOpen] = useState(true);
  const active = list.filter((a) => a.is_active);
  const total = active.reduce((s, a) => s + a.balance_converted, 0);
  const tracked = active.filter((a) => a.balance_30d_ago !== null);
  const change = tracked.reduce((s, a) => s + (a.balance - a.balance_30d_ago!) * a.rate, 0);
  const base = tracked.reduce((s, a) => s + a.balance_30d_ago! * a.rate, 0);
  const pct = base ? (change / Math.abs(base)) * 100 : null;
  const liability = list[0]?.classification === "liability";
  const good = liability ? change <= 0 : change >= 0;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 sm:px-7">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${TYPE_LABELS[type] ?? type}`} className="icon-btn !h-8 !w-8">
          <Icon name={open ? "chevronDown" : "chevronRight"} />
        </button>
        <h2 className="text-[16px] font-semibold">{TYPE_LABELS[type] ?? type}</h2>
        {tracked.length > 0 && Math.abs(change) >= 0.005 && (
          <span className={cx("hidden text-[13px] tabular-nums sm:inline", good ? "text-emerald-600" : "text-red-600")}>
            {change > 0 ? "↑" : "↓"} {money(Math.abs(change), currency)}{pct !== null && ` (${Math.abs(pct).toFixed(1)}%)`} <span className="muted">1 month change</span>
          </span>
        )}
        <span className="ml-auto text-[17px] font-semibold"><BigMoney value={total} currency={currency} /></span>
      </div>
      {open && <div className="divide-y divide-zinc-100 border-t border-zinc-100">{list.map((a) => <AccountRow key={a.id} a={a} currency={currency} />)}</div>}
    </section>
  );
}

export default function Accounts() {
  const { data, isLoading } = useAccounts();
  const [adding, setAdding] = useState(false);
  if (isLoading || !data) return <PageSkeleton />;
  const cur = data.currency;
  const groups = (types: string[]) => types.map((t) => ({ t, list: data.accounts.filter((a) => a.accountable_type === t) })).filter((g) => g.list.length);
  const assets = groups(ASSET_TYPES);
  const liabilities = groups(LIABILITY_TYPES);
  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Accounts</h1></div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="card px-5 py-4 sm:px-7"><div className="eyebrow">Assets</div><div className="stat mt-1"><BigMoney value={data.assets} currency={cur} /></div></div>
        <div className="card px-5 py-4 sm:px-7"><div className="eyebrow">Liabilities</div><div className="stat mt-1"><BigMoney value={data.liabilities} currency={cur} /></div></div>
      </div>
      {assets.map((g) => <Group key={g.t} type={g.t} list={g.list} currency={cur} />)}
      {liabilities.length > 0 && <h2 className="section-title -mb-4">Liabilities</h2>}
      {liabilities.map((g) => <Group key={g.t} type={g.t} list={g.list} currency={cur} />)}
      {!assets.length && !liabilities.length && <p className="muted p-5 text-sm">Nothing here yet.</p>}
      {adding && <NewAccountModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewAccountModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const me = useMe().data;
  const [type, setType] = useState("Depository");
  const [name, setName] = useState("");
  const [subtype, setSubtype] = useState("");
  const [balance, setBalance] = useState("0");
  const [currency, setCurrency] = useState(me?.currency ?? "USD");
  const [date, setDate] = useState("");
  const save = useAction(
    () => api<{ id: string }>("/api/accounts", { method: "POST", body: { name, type, subtype: subtype || null, balance: Number(balance), currency, date: date || undefined } }),
    (r) => { onClose(); nav(`/accounts/${r.id}`); },
  );
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const liability = LIABILITY_TYPES.includes(type);
  return (
    <Modal title="New account" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => { setType(e.target.value); setSubtype(""); }}>
            <optgroup label="Assets">{ASSET_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</optgroup>
            <optgroup label="Liabilities">{LIABILITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Name"><input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DBS Savings" /></Field>
        {SUBTYPES[type] && (
          <Field label="Subtype">
            <select className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
              <option value="">—</option>{SUBTYPES[type]!.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={liability ? "Amount owed" : "Current balance"}><input className="input" type="number" step="0.01" required value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
          <Field label="Currency"><input className="input uppercase" maxLength={3} minLength={3} required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
        </div>
        <Field label="Balance as of" hint="Defaults to yesterday so transactions you add today are applied on top.">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>Create account</button></div>
      </form>
    </Modal>
  );
}
