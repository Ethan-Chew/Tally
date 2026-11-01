import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Entry } from "../api";
import { EntryList } from "../components/EntryList";
import { TransactionModal, TransferModal } from "../components/EntryForms";
import { Icon } from "../components/Icon";
import { Empty, LoadMore, Skeleton } from "../components/ui";
import { useAccounts, useAction, useCategories, useEntries, useTags } from "../hooks";
import { cx, money } from "../lib";

const EMPTY = { q: "", account_id: "", category_id: "", tag_id: "", type: "", from: "", to: "" };

export default function Transactions() {
  const accounts = useAccounts().data?.accounts ?? [];
  const categories = useCategories().data ?? [];
  const tags = useTags().data ?? [];

  // other pages (cash flow, reports) link here with filters in the URL
  const [params] = useSearchParams();
  const [f, setF] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, params.get(k) ?? ""]).filter(([, v]) => v)) } as typeof EMPTY));
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => Object.keys(EMPTY).some((k) => k !== "q" && params.get(k)));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(f.q), 250);
    return () => clearTimeout(t);
  }, [f.q]);
  useEffect(() => setSelected(new Set()), [debouncedQ, f.account_id, f.category_id, f.tag_id, f.type, f.from, f.to]);

  const list = useEntries({ ...f, q: debouncedQ }, 30);
  const bulkDelete = useAction(() => api("/api/entries/bulk-delete", { method: "POST", body: { ids: [...selected] } }), () => setSelected(new Set()));
  const bulkCategory = useAction((category_id: string) => api("/api/entries/bulk-update", { method: "POST", body: { ids: [...selected], category_id: category_id || null } }), () => setSelected(new Set()));

  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const filterCount = Object.entries(f).filter(([k, v]) => k !== "q" && v).length;
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
  const stat = (label: string, value: string, tone = "") => (
    <div className="min-w-0 px-4 py-5 sm:px-7">
      <div className="eyebrow">{label}</div>
      <div className={cx("stat mt-1.5 truncate !text-[14px] sm:!text-[22px]", tone)}>{list.loaded ? value : <Skeleton className="h-7 w-24" />}</div>
    </div>
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Transactions</h1>
        <div className="flex items-center gap-2">
          <Link to="/settings/import" className="icon-btn" aria-label="Import CSV" title="Import CSV"><Icon name="upload" /></Link>
          <button className="btn" onClick={() => setTransfer(true)}><Icon name="swap" className="h-4 w-4" />Transfer</button>
          <button className="btn btn-primary" onClick={() => setEditing("new")}><Icon name="plus" className="h-4 w-4" />New</button>
        </div>
      </div>

      <section className="card grid grid-cols-3 divide-x divide-zinc-100 [&>*]:min-w-0">
        {stat(filterCount || f.q ? "Found" : "Total", list.total.toLocaleString())}
        {stat("Income", money(list.income, list.currency, { maximumFractionDigits: 0 }), "!text-emerald-600")}
        {stat("Expenses", money(list.expense, list.currency, { maximumFractionDigits: 0 }), "!text-rose-600")}
      </section>

      <section className={cx("card overflow-hidden transition-opacity", list.isFetching && !list.isFetchingNextPage && "opacity-60")}>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex gap-2.5">
            <div className="relative flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input className="input !h-10 !rounded-xl !pl-10" type="search" placeholder="Search transactions" aria-label="Search" value={f.q} onChange={(e) => set("q")(e.target.value)} />
            </div>
            <button className={cx("btn !h-10 !rounded-xl", f.category_id === "none" && "!bg-tint !text-accent")} aria-pressed={f.category_id === "none"} onClick={() => set("category_id")(f.category_id === "none" ? "" : "none")}>Needs review</button>
            <button className={cx("btn !h-10 !rounded-xl", filtersOpen && "!bg-tint !text-accent")} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
              <Icon name="filter" className="h-4 w-4" />Filter{filterCount > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{filterCount}</span>}
            </button>
          </div>
          {filtersOpen && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <select className="input" aria-label="Account" value={f.account_id} onChange={(e) => set("account_id")(e.target.value)}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select className="input" aria-label="Category" value={f.category_id} onChange={(e) => set("category_id")(e.target.value)}><option value="">All categories</option><option value="none">Uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select className="input" aria-label="Type" value={f.type} onChange={(e) => set("type")(e.target.value)}><option value="">Income & expenses</option><option value="expense">Expenses</option><option value="income">Income</option><option value="transfer">Transfers</option></select>
              <select className="input" aria-label="Tag" value={f.tag_id} onChange={(e) => set("tag_id")(e.target.value)}><option value="">All tags</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <input className="input" type="date" aria-label="From date" value={f.from} onChange={(e) => set("from")(e.target.value)} />
              <input className="input" type="date" aria-label="To date" value={f.to} onChange={(e) => set("to")(e.target.value)} />
              {filterCount > 0 && <button className="btn btn-ghost sm:col-span-2 lg:col-span-3" onClick={() => setF({ ...EMPTY, q: f.q })}>Clear filters</button>}
            </div>
          )}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-tint px-4 py-3 text-[13px]">
              <span className="font-medium text-accent">{selected.size} selected</span>
              <select className="input !w-auto" aria-label="Set category" value="" onChange={(e) => e.target.value !== "" && bulkCategory.mutate(e.target.value === "none" ? "" : e.target.value)}>
                <option value="">Set category…</option><option value="none">Uncategorized</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn btn-danger" disabled={bulkDelete.isPending} onClick={() => confirm(`Delete ${selected.size} entries? Transfers delete both halves.`) && bulkDelete.mutate()}>Delete</button>
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>

        {!list.loaded ? (
          <div className="space-y-4 p-6">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : list.rows.length === 0 ? (
          <Empty>{filterCount || f.q ? "No transactions match." : "No transactions yet."}</Empty>
        ) : (
          <>
            <EntryList entries={list.rows} selected={selected} onSelect={toggle} onEdit={setEditing} />
            <LoadMore onVisible={list.loadMore} loading={list.isFetchingNextPage} hasMore={list.hasMore} />
          </>
        )}
      </section>

      {editing && <TransactionModal entry={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {transfer && <TransferModal onClose={() => setTransfer(false)} />}
    </div>
  );
}
