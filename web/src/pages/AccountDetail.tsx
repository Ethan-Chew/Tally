import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Entry } from "../api";
import { EntryList } from "../components/EntryList";
import { Icon } from "../components/Icon";
import { TransactionModal, TransferModal } from "../components/EntryForms";
import { BigMoney, Empty, ErrorNote, Field, LoadMore, Modal, MoneyInput, PageSkeleton, Pills } from "../components/ui";
import { useAction, useEntries } from "../hooks";
import { cx, fmtDate, money, todayStr, TYPE_LABELS } from "../lib";

interface Detail {
  account: { id: string; name: string; accountable_type: string; subtype: string | null; classification: "asset" | "liability"; balance: number; currency: string; is_active: boolean };
  series: { date: string; balance: number }[];
  holdings: { id: string; ticker: string; name: string | null; qty: number; price: number; amount: number; currency: string; date: string }[];
}

const RANGES = [{ value: "30", label: "30D" }, { value: "90", label: "90D" }, { value: "365", label: "1Y" }, { value: "all", label: "All" }];

export default function AccountDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [range, setRange] = useState("90");
  const [tab, setTab] = useState<"activity" | "holdings">("activity");
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [valuing, setValuing] = useState<Entry | boolean>(false);
  const [settings, setSettings] = useState(false);
  const [transfer, setTransfer] = useState(false);

  const detail = useQuery({ queryKey: ["account", id], queryFn: () => api<Detail>(`/api/accounts/${id}`) });
  const entries = useEntries({ account_id: id, kind: "all" }, 25);
  if (detail.isLoading) return <PageSkeleton />;
  if (!detail.data) return <Empty>Account not found. <Link className="underline" to="/accounts">Back to accounts</Link></Empty>;

  const { account: a, series, holdings } = detail.data;
  const cutoff = range === "all" ? "" : new Date(Date.now() - Number(range) * 864e5).toLocaleDateString("en-CA");
  const shown = series.filter((p) => p.date >= cutoff);
  const first = shown[0]?.balance ?? a.balance;
  const delta = a.balance - first;
  const good = a.classification === "asset" ? delta >= 0 : delta <= 0;

  const onEdit = (e: Entry) => (e.entryable_type === "Account::Valuation" ? setValuing(e) : setEditing(e));

  return (
    <div className="space-y-8 sm:space-y-10">
      <div>
        <Link to="/accounts" className="icon-btn" aria-label="Back to accounts" title="Accounts"><Icon name="chevronLeft" /></Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title">{a.name} {!a.is_active && <span className="pill bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Disabled</span>}</h1>
            <p className="muted text-sm">{TYPE_LABELS[a.accountable_type]}{a.subtype ? ` · ${a.subtype.replace(/_/g, " ")}` : ""} · {a.currency}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setValuing(true)} title="Set the balance to match your statement"><Icon name="edit" className="h-4 w-4" />Rebalance</button>
            <button className="btn" onClick={() => setTransfer(true)}><Icon name="swap" className="h-4 w-4" />Transfer</button>
            <button className="btn btn-primary" onClick={() => setEditing("new")}><Icon name="plus" className="h-4 w-4" />Add</button>
            <button className="icon-btn" onClick={() => setSettings(true)} aria-label="Account settings" title="Account settings"><Icon name="settings" /></button>
          </div>
        </div>
      </div>

      <section className="card p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="hero-num"><BigMoney value={a.balance} currency={a.currency} /></div>
            <div className={cx("text-sm tabular-nums", good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {delta >= 0 ? "▲" : "▼"} {money(Math.abs(delta), a.currency)} <span className="muted">in this range</span>
            </div>
          </div>
          <Pills value={range} options={RANGES} onChange={setRange} />
        </div>
        <div className="mt-3 h-52">
          {shown.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={shown} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs><linearGradient id="bal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" tickFormatter={(v) => fmtDate(v, { day: "numeric", month: "short" })} tick={{ fontSize: 11 }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip formatter={(v) => money(Number(v), a.currency)} labelFormatter={(l) => fmtDate(String(l))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Area type="stepAfter" dataKey="balance" name="Balance" stroke="#6366f1" strokeWidth={2} fill="url(#bal)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty>No balance history in this range.</Empty>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex gap-4 border-b border-gray-100 px-6 dark:border-gray-800">
          {(["activity", ...(holdings.length ? ["holdings"] : [])] as const).map((t) => (
            <button key={t} onClick={() => setTab(t as "activity" | "holdings")} className={cx("-mb-px border-b-2 py-3 text-sm font-medium capitalize", tab === t ? "border-gray-900 dark:border-gray-100" : "muted border-transparent")}>{t}</button>
          ))}
        </div>
        {tab === "activity" ? (
          <>
            {entries.rows.length ? <EntryList entries={entries.rows} showAccount={false} onEdit={onEdit} /> : <Empty>{entries.loaded ? "No activity yet." : "Loading…"}</Empty>}
            <LoadMore onVisible={entries.loadMore} loading={entries.isFetchingNextPage} hasMore={entries.hasMore} />
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-200 dark:border-gray-800"><th className="th">Holding</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Value</th></tr></thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800/60">
                    <td className="td"><div className="font-medium">{h.ticker}</div><div className="muted text-xs">{h.name}</div></td>
                    <td className="td text-right tabular-nums">{h.qty}</td>
                    <td className="td text-right tabular-nums">{money(h.price, h.currency)}</td>
                    <td className="td text-right font-medium tabular-nums">{money(h.amount, h.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted px-5 py-3.5 sm:px-7 text-xs">As of {holdings[0] && fmtDate(holdings[0].date)}. Holdings are read from your existing data and aren't recalculated here.</p>
          </div>
        )}
      </section>

      {editing && <TransactionModal entry={editing === "new" ? undefined : editing} defaultAccountId={id} onClose={() => setEditing(null)} />}
      {valuing && <ValuationModal accountId={id} currency={a.currency} current={a.balance} entry={typeof valuing === "object" ? valuing : undefined} onClose={() => setValuing(false)} />}
      {transfer && <TransferModal fromId={id} onClose={() => setTransfer(false)} />}
      {settings && <SettingsModal account={a} onClose={() => setSettings(false)} onDeleted={() => nav("/accounts")} />}
    </div>
  );
}

function ValuationModal({ accountId, currency, current, entry, onClose }: { accountId: string; currency: string; current: number; entry?: Entry; onClose: () => void }) {
  const [amount, setAmount] = useState(String(entry?.amount ?? current));
  const [date, setDate] = useState(entry?.date ?? todayStr());
  const save = useAction(() => api(`/api/accounts/${accountId}/valuations`, { method: "POST", body: { date, amount: Number(amount) } }), onClose);
  const remove = useAction(() => api(`/api/entries/${entry!.id}`, { method: "DELETE" }), onClose);
  const valid = amount !== "" && Number.isFinite(Number(amount)) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid && !save.isPending) save.mutate(); };
  return (
    <Modal title={entry ? "Edit rebalance" : "Rebalance"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="muted text-sm">Forces the balance to this amount as of a date, e.g. to match your statement or an investment app. Transactions after that date build on top of it.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="label">New balance</span><MoneyInput currency={currency} allowNegative autoFocus value={amount} onChange={setAmount} /></div>
          <Field label="As of"><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {!entry && date === todayStr() && Number(amount) !== current && amount !== "" && (
          <p className="muted text-sm">Changes the balance by <span className="font-medium tabular-nums text-zinc-900">{money(Number(amount) - current, currency)}</span> (now {money(current, currency)}).</p>
        )}
        <ErrorNote error={save.error ?? remove.error} />
        <div className="flex items-center justify-between">
          {entry ? <button type="button" className="btn btn-danger" onClick={() => confirm("Delete this balance update?") && remove.mutate()}>Delete</button> : <span />}
          <div className="flex gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending || !valid}>Save</button></div>
        </div>
      </form>
    </Modal>
  );
}

function SettingsModal({ account, onClose, onDeleted }: { account: Detail["account"]; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(account.name);
  const save = useAction(() => api(`/api/accounts/${account.id}`, { method: "PATCH", body: { name } }), onClose);
  const toggle = useAction(() => api(`/api/accounts/${account.id}`, { method: "PATCH", body: { is_active: !account.is_active } }), onClose);
  const del = useAction(() => api(`/api/accounts/${account.id}`, { method: "DELETE" }), onDeleted);
  return (
    <Modal title="Account settings" onClose={onClose}>
      <div className="space-y-4">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="flex-1"><Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <button className="btn btn-primary" disabled={save.isPending || name === account.name}>Rename</button>
        </form>
        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div><div className="text-sm font-medium">{account.is_active ? "Disable account" : "Enable account"}</div><div className="muted text-xs">Disabled accounts are left out of net worth.</div></div>
          <button className="btn" onClick={() => toggle.mutate()} disabled={toggle.isPending}>{account.is_active ? "Disable" : "Enable"}</button>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-red-200 p-3 dark:border-red-900">
          <div><div className="text-sm font-medium">Delete account</div><div className="muted text-xs">Removes the account and all of its transactions. Can't be undone.</div></div>
          <button className="btn btn-danger" disabled={del.isPending} onClick={() => confirm(`Delete "${account.name}" and all its transactions?`) && del.mutate()}>Delete</button>
        </div>
        <ErrorNote error={save.error ?? toggle.error ?? del.error} />
      </div>
    </Modal>
  );
}
