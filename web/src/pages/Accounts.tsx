import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Account } from "../api";
import { Icon } from "../components/Icon";
import { BigMoney, ErrorNote, Field, Modal, PageSkeleton } from "../components/ui";
import { useAccounts, useAction, useMe } from "../hooks";
import { ASSET_TYPES, cx, LIABILITY_TYPES, money, TYPE_ICONS, TYPE_LABELS } from "../lib";

const SUBTYPES: Record<string, string[]> = {
  Depository: ["checking", "savings"],
  Investment: ["brokerage", "retirement", "401k", "ira", "roth_ira", "hsa", "other"],
};

export function AccountRow({ a, currency }: { a: Account; currency: string }) {
  const change = a.balance_30d_ago !== null ? a.balance - a.balance_30d_ago : null;
  const good = change !== null && (a.classification === "asset" ? change >= 0 : change <= 0);
  return (
    <Link to={`/accounts/${a.id}`} className={cx("flex items-center gap-4 px-5 py-4 sm:px-7 hover:bg-soft dark:hover:bg-gray-800/40", !a.is_active && "opacity-50")}>
      <span className="icon-circle"><Icon name={TYPE_ICONS[a.accountable_type] ?? "accounts"} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{a.name} {!a.is_active && <span className="pill bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Disabled</span>}</div>
        <div className="muted mt-0.5 text-xs">{TYPE_LABELS[a.accountable_type] ?? a.accountable_type}{a.subtype ? ` · ${a.subtype.replace(/_/g, " ")}` : ""}{a.currency !== currency ? ` · ${a.currency}` : ""}</div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-semibold"><BigMoney value={a.balance} currency={a.currency} /></div>
        {a.currency !== currency && <div className="muted text-xs tabular-nums">≈ {money(a.balance_converted, currency)}</div>}
        {change !== null && Math.abs(change) >= 0.005 && (
          <div className={cx("text-xs tabular-nums", good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{change > 0 ? "+" : "−"}{money(Math.abs(change), a.currency)} /30d</div>
        )}
      </div>
    </Link>
  );
}

export default function Accounts() {
  const { data, isLoading } = useAccounts();
  const [adding, setAdding] = useState(false);
  if (isLoading || !data) return <PageSkeleton />;
  const cur = data.currency;
  const group = (cls: "asset" | "liability") => data.accounts.filter((a) => a.classification === cls);
  const section = (title: string, list: Account[], total: number) => (
    <section className="card overflow-hidden">
      <div className="card-head">
        <h2 className="section-title">{title}</h2><span className="text-[18px] font-semibold"><BigMoney value={total} currency={cur} /></span>
      </div>
      {list.length ? <div className="divide-y divide-gray-100 dark:divide-gray-800">{list.map((a) => <AccountRow key={a.id} a={a} currency={cur} />)}</div> : <p className="muted p-5 text-sm">Nothing here yet.</p>}
    </section>
  );
  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Accounts</h1></div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />Add</button>
      </div>
      {section("Assets", group("asset"), data.assets)}
      {section("Liabilities", group("liability"), data.liabilities)}
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
