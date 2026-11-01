import { useEffect, useState, type FormEvent } from "react";
import { api, qs, type Entry } from "../api";
import { useAccounts, useAction, useCategories, useMerchants, useTags } from "../hooks";
import { cx, todayStr } from "../lib";
import { Icon } from "./Icon";
import { ErrorNote, Field, Modal, MoneyInput } from "./ui";

const MIN_DATE = "2000-01-01";
const isoDay = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };

/** Inline message under a field; only shown once the field was left or a save was attempted. */
function Problem({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-1.5 text-xs text-red-600">{text}</p> : null;
}

/** Create or edit a transaction. Amount is always entered positive; the toggle decides expense vs. income. */
export function TransactionModal({ entry, defaultAccountId, onClose }: { entry?: Entry; defaultAccountId?: string; onClose: () => void }) {
  const accounts = useAccounts().data?.accounts.filter((a) => a.is_active || a.id === entry?.account_id) ?? [];
  const categories = useCategories().data ?? [];
  const merchants = useMerchants().data ?? [];
  const tags = useTags().data ?? [];

  const [type, setType] = useState<"expense" | "income">(entry ? (entry.amount > 0 ? "expense" : "income") : "expense");
  const [amount, setAmount] = useState(entry ? Math.abs(entry.amount).toFixed(2) : "");
  const [date, setDate] = useState(entry?.date ?? todayStr());
  const [name, setName] = useState(entry?.name ?? "");
  const [pickedAccount, setAccountId] = useState(entry?.account_id ?? defaultAccountId ?? "");
  const lastUsed = (() => { try { return localStorage.getItem("tally.lastAccount") ?? ""; } catch { return ""; } })();
  // until one is chosen: the account used for the last new transaction, else the first
  const accountId = pickedAccount || (accounts.some((a) => a.id === lastUsed) ? lastUsed : accounts[0]?.id) || "";
  const account = accounts.find((a) => a.id === accountId);
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? "");
  const [merchant, setMerchant] = useState(entry?.merchant_name ?? "");
  const [tagIds, setTagIds] = useState<string[]>(entry?.tags.map((t) => t.id) ?? []);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [excluded, setExcluded] = useState(entry?.excluded ?? false);
  // the less common fields stay folded away unless the transaction already uses them
  const [more, setMore] = useState(!!(entry && (entry.merchant_name || entry.tags.length || entry.notes || entry.excluded)));
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const touch = (k: string) => setSeen((s) => ({ ...s, [k]: true }));

  // while the category is empty, look up what similar past transactions were filed under and offer it (never applied silently)
  const [suggestedId, setSuggestedId] = useState("");
  useEffect(() => {
    if (categoryId || name.trim().length < 3) { setSuggestedId(""); return; }
    let live = true;
    const t = setTimeout(() => {
      api<{ category_id: string | null }>(`/api/suggest-category${qs({ name: name.trim(), merchant: merchant.trim() || undefined })}`)
        .then((r) => live && setSuggestedId(r.category_id ?? ""))
        .catch(() => live && setSuggestedId(""));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [name, merchant, categoryId]);
  const suggested = categories.find((c) => c.id === suggestedId);

  const today = todayStr();
  const maxDate = addDays(today, 365);
  const n = Number(amount);
  const problems: Record<string, string | undefined> = {
    amount: !(n > 0) ? "Enter an amount above 0." : n >= 1e9 ? "That amount is too large." : undefined,
    name: !name.trim() ? "Describe it in a few words, e.g. Groceries." : undefined,
    date: !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) ? "Pick a valid date." : date < MIN_DATE || date > maxDate ? "Pick a date within the last decades and the next year." : undefined,
    account: !accountId ? "Choose an account." : undefined,
  };
  const shown = (k: string) => ((seen[k] || tried) ? problems[k] : undefined);
  const firstBad = ["amount", "name", "date", "account"].find((k) => problems[k]);

  const save = useAction(
    () => {
      const body = {
        account_id: accountId, date, name: name.trim(), amount: n, type,
        category_id: categoryId || null,
        merchant_name: merchant.trim() || null,
        ...(entry && !merchant.trim() ? { merchant_id: null, merchant_name: undefined } : {}),
        tag_ids: tagIds, notes: notes.trim() || null, excluded,
      };
      if (!entry) { try { localStorage.setItem("tally.lastAccount", accountId); } catch { /* remembering is a convenience only */ } }
      return entry ? api(`/api/entries/${entry.id}`, { method: "PATCH", body }) : api("/api/entries", { method: "POST", body });
    },
    onClose,
  );
  const remove = useAction(() => api(`/api/entries/${entry!.id}`, { method: "DELETE" }), onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    setTried(true);
    if (firstBad) { document.getElementById(`tx-${firstBad}`)?.focus(); return; }
    save.mutate();
  };
  const sameKind = categories.filter((c) => c.classification === type);
  const otherKind = categories.filter((c) => c.classification !== type);
  const field = "input !h-10 !rounded-xl !text-[14px]";
  const err = "!border-red-400 focus:!border-red-500 focus:!ring-red-500/10";

  return (
    <Modal title={entry ? "Edit transaction" : "New transaction"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-soft p-1" role="group" aria-label="Type">
          {(["expense", "income"] as const).map((t) => (
            <button type="button" key={t} aria-pressed={type === t} onClick={() => { setType(t); if (categoryId && categories.find((c) => c.id === categoryId)?.classification !== t) setCategoryId(""); }}
              className={cx("rounded-lg py-2 text-sm font-medium capitalize transition", type === t ? cx("bg-white shadow-sm", t === "expense" ? "text-red-600" : "text-emerald-600") : "muted hover:text-zinc-900")}>{t}</button>
          ))}
        </div>

        <div>
          <MoneyInput id="tx-amount" large autoFocus={!entry} currency={account?.currency} value={amount} onChange={setAmount} onBlur={() => touch("amount")} invalid={!!shown("amount")} />
          <div className="text-center"><Problem text={shown("amount")} /></div>
        </div>

        <div>
          <input id="tx-name" className={cx(field, shown("name") && err)} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch("name")}
            placeholder="What was it for?" aria-label="Description" aria-invalid={!!shown("name") || undefined} autoComplete="off" />
          <Problem text={shown("name")} />
        </div>

        <div>
          <span className="label">Category</span>
          <select className={field} aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            {sameKind.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {otherKind.length > 0 && <optgroup label={type === "expense" ? "Income categories" : "Expense categories"}>{otherKind.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
          </select>
          {suggested && suggested.classification === type && (
            <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-tint px-3 py-1 text-xs font-medium text-accent hover:bg-tint-strong" onClick={() => setCategoryId(suggested.id)}>
              Use “{suggested.name}” <span className="muted font-normal">· like similar transactions</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Date</span>
            <input id="tx-date" className={cx(field, shown("date") && err)} type="date" min={MIN_DATE} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => touch("date")} aria-label="Date" />
            <div className="mt-1.5 flex gap-1.5">
              {([["Today", today], ["Yesterday", addDays(today, -1)]] as const).map(([label, d]) => (
                <button type="button" key={label} onClick={() => setDate(d)} aria-pressed={date === d} className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium transition", date === d ? "bg-tint text-accent" : "muted hover:bg-soft")}>{label}</button>
              ))}
            </div>
            <Problem text={shown("date")} />
          </div>
          <div>
            <span className="label">Account</span>
            <select id="tx-account" className={cx(field, shown("account") && err)} aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} onBlur={() => touch("account")}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
            </select>
            <Problem text={shown("account")} />
          </div>
        </div>

        <div className="border-t border-zinc-100 pt-3">
          <button type="button" className="flex w-full items-center justify-between text-sm font-medium text-zinc-600 hover:text-zinc-900" aria-expanded={more} onClick={() => setMore(!more)}>
            More options <span className="muted text-xs font-normal">merchant, tags, notes</span>
            <Icon name="chevronDown" className={cx("h-4 w-4 shrink-0 transition", more && "rotate-180")} />
          </button>
          {more && (
            <div className="mt-4 space-y-4">
              <div>
                <span className="label">Merchant</span>
                <input className={field} list="merchant-list" maxLength={80} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Optional" aria-label="Merchant" autoComplete="off" />
                <datalist id="merchant-list">{merchants.map((m) => <option key={m.id} value={m.name} />)}</datalist>
              </div>
              {tags.length > 0 && (
                <div>
                  <span className="label">Tags</span>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const on = tagIds.includes(t.id);
                      return (
                        <button type="button" key={t.id} aria-pressed={on} onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                          className={cx("pill border", on ? "text-white" : "muted border-zinc-200")} style={on ? { background: t.color, borderColor: t.color } : undefined}>{t.name}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <span className="label">Notes</span>
                <textarea className="input !rounded-xl !text-[14px]" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              </div>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-0.5" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
                <span>Leave out of budgets and reports <span className="muted block text-xs">It still counts toward the account balance.</span></span>
              </label>
            </div>
          )}
        </div>

        <ErrorNote error={save.error ?? remove.error} />
        <div className="flex items-center justify-between gap-2">
          {entry ? (
            <button type="button" className="btn btn-danger" disabled={remove.isPending}
              onClick={() => confirm(entry.transfer_id ? "This is half of a transfer — both sides will be deleted. Continue?" : "Delete this transaction?") && remove.mutate()}>Delete</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn !h-10 !rounded-xl" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary !h-10 !rounded-xl !px-5" disabled={save.isPending}>{save.isPending ? "Saving…" : entry ? "Save changes" : "Add transaction"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function TransferModal({ onClose, fromId }: { onClose: () => void; fromId?: string }) {
  const accounts = useAccounts().data?.accounts.filter((a) => a.is_active) ?? [];
  const [picked, setFrom] = useState(fromId ?? "");
  const [pickedTo, setTo] = useState("");
  // until one is chosen: the account the transfer was started from (or the first), and the first other account
  const from = picked || accounts[0]?.id || "";
  const to = pickedTo || accounts.find((a) => a.id !== from)?.id || "";
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const fromAcc = accounts.find((a) => a.id === from);
  const toAcc = accounts.find((a) => a.id === to);
  const crossCurrency = fromAcc && toAcc && fromAcc.currency !== toAcc.currency;

  const save = useAction(
    () => api("/api/transfers", { method: "POST", body: { from_account_id: from, to_account_id: to, amount: Number(amount), to_amount: crossCurrency && toAmount ? Number(toAmount) : undefined, date } }),
    onClose,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (Number(amount) > 0 && from && to && from !== to && !save.isPending) save.mutate();
  };
  return (
    <Modal title="New transfer" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="muted text-sm">Moves money between your accounts. Transfers don't count as income or spending.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="To"><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="label">Amount</span><MoneyInput currency={fromAcc?.currency} value={amount} onChange={setAmount} autoFocus /></div>
          <Field label="Date"><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {crossCurrency && <div><span className="label">Amount received</span><MoneyInput currency={toAcc!.currency} value={toAmount} onChange={setToAmount} /></div>}
        {from && to && from === to && <p role="alert" className="text-xs text-red-600">Choose two different accounts.</p>}
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending || !(Number(amount) > 0) || !from || !to || from === to || (!!crossCurrency && !(Number(toAmount) > 0))}>Create transfer</button>
        </div>
      </form>
    </Modal>
  );
}
