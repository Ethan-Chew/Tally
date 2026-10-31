import { useEffect, useState, type FormEvent } from "react";
import { api, qs, type Entry } from "../api";
import { useAccounts, useAction, useCategories, useMerchants, useTags } from "../hooks";
import { cx, todayStr } from "../lib";
import { ErrorNote, Field, Modal } from "./ui";

/** Create or edit a transaction. Amount is always entered positive; the toggle decides expense vs. income. */
export function TransactionModal({ entry, defaultAccountId, onClose }: { entry?: Entry; defaultAccountId?: string; onClose: () => void }) {
  const accounts = useAccounts().data?.accounts.filter((a) => a.is_active || a.id === entry?.account_id) ?? [];
  const categories = useCategories().data ?? [];
  const merchants = useMerchants().data ?? [];
  const tags = useTags().data ?? [];

  const [type, setType] = useState<"expense" | "income">(entry ? (entry.amount > 0 ? "expense" : "income") : "expense");
  const [amount, setAmount] = useState(entry ? String(Math.abs(entry.amount)) : "");
  const [date, setDate] = useState(entry?.date ?? todayStr());
  const [name, setName] = useState(entry?.name ?? "");
  const [accountId, setAccountId] = useState(entry?.account_id ?? defaultAccountId ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? "");
  const [merchant, setMerchant] = useState(entry?.merchant_name ?? "");
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
  const [tagIds, setTagIds] = useState<string[]>(entry?.tags.map((t) => t.id) ?? []);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [excluded, setExcluded] = useState(entry?.excluded ?? false);

  const save = useAction(
    () => {
      const body = {
        account_id: accountId, date, name, amount: Number(amount), type,
        category_id: categoryId || null,
        merchant_name: merchant.trim() || null,
        ...(entry && !merchant.trim() ? { merchant_id: null, merchant_name: undefined } : {}),
        tag_ids: tagIds, notes: notes || null, excluded,
      };
      return entry ? api(`/api/entries/${entry.id}`, { method: "PATCH", body }) : api("/api/entries", { method: "POST", body });
    },
    onClose,
  );
  const remove = useAction(() => api(`/api/entries/${entry!.id}`, { method: "DELETE" }), onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const sameKind = categories.filter((c) => c.classification === type);

  return (
    <Modal title={entry ? "Edit transaction" : "New transaction"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          {(["expense", "income"] as const).map((t) => (
            <button type="button" key={t} onClick={() => setType(t)} className={cx("rounded-md py-1.5 text-sm font-medium capitalize", type === t ? "bg-white shadow-xs dark:bg-gray-950" : "muted")}>{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><input className="input" type="number" step="0.01" min="0.01" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groceries" /></Field>
        <Field label="Account">
          <select className="input" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {sameKind.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {categories.filter((c) => c.classification !== type).length > 0 && (
                <optgroup label="Other">{categories.filter((c) => c.classification !== type).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              )}
            </select>
            {suggested && <button type="button" className="mt-1.5 text-xs text-accent hover:underline" onClick={() => setCategoryId(suggested.id)}>Use “{suggested.name}”, like similar transactions</button>}
          </Field>
          <Field label="Merchant">
            <input className="input" list="merchant-list" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Optional" />
            <datalist id="merchant-list">{merchants.map((m) => <option key={m.id} value={m.name} />)}</datalist>
          </Field>
        </div>
        {tags.length > 0 && (
          <div>
            <span className="label">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button type="button" key={t.id} onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                    className={cx("pill border", on ? "text-white" : "muted border-gray-300 dark:border-gray-700")} style={on ? { background: t.color, borderColor: t.color } : undefined}>
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <Field label="Notes"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
          Exclude from budgets and reports <span className="muted text-xs">(still counts toward the account balance)</span>
        </label>
        <ErrorNote error={save.error ?? remove.error} />
        <div className="flex items-center justify-between pt-1">
          {entry ? (
            <button type="button" className="btn btn-danger" disabled={remove.isPending}
              onClick={() => confirm(entry.transfer_id ? "This is half of a transfer — both sides will be deleted. Continue?" : "Delete this transaction?") && remove.mutate()}>Delete</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function TransferModal({ onClose }: { onClose: () => void }) {
  const accounts = useAccounts().data?.accounts.filter((a) => a.is_active) ?? [];
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
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
    save.mutate();
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
          <Field label={`Amount${fromAcc ? ` (${fromAcc.currency})` : ""}`}><input className="input" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date"><input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {crossCurrency && <Field label={`Amount received (${toAcc!.currency})`}><input className="input" type="number" step="0.01" min="0.01" required value={toAmount} onChange={(e) => setToAmount(e.target.value)} /></Field>}
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={save.isPending}>Create transfer</button>
        </div>
      </form>
    </Modal>
  );
}
