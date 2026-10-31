import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { api } from "../api";
import { Amount } from "../components/EntryList";
import { Empty, ErrorNote, Field } from "../components/ui";
import { useAccounts, useAction } from "../hooks";
import { cx, fmtDate, money } from "../lib";

interface Described { delimiter: string; headers: string[]; row_count: number; sample: string[][]; suggested_mapping: Record<string, string> }
interface Preview {
  account: string; currency: string; total_rows: number; valid: number; to_import: number; duplicates: number; imported: number;
  errors: { line: number; message: string }[]; error_count: number; unknown_categories: string[];
  preview: { date: string; name: string; amount: number; category: string }[]; income: number; expense: number;
}

const DATE_FORMATS = [
  { value: "auto", label: "Auto (YYYY-MM-DD, 5 Jan 2026…)" },
  { value: "dmy", label: "Day / Month / Year" },
  { value: "mdy", label: "Month / Day / Year" },
];

export default function Import() {
  const accounts = useAccounts().data?.accounts.filter((a) => a.is_active) ?? [];
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [desc, setDesc] = useState<Described | null>(null);
  const [descError, setDescError] = useState<string | null>(null);

  const [map, setMap] = useState<Record<string, string>>({});
  const [split, setSplit] = useState(false); // separate debit / credit columns
  const [dateFormat, setDateFormat] = useState("auto");
  const [expenseSign, setExpenseSign] = useState<"negative" | "positive">("negative");
  const [skipDupes, setSkipDupes] = useState(true);
  const [createCats, setCreateCats] = useState(true);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<Preview | null>(null);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);

  // Step 1 -> 2: describe the file as soon as it's loaded
  useEffect(() => {
    setDesc(null); setDescError(null); setPreview(null); setResult(null);
    if (!csv.trim()) return;
    api<Described>("/api/import", { method: "POST", body: { csv } })
      .then((d) => {
        setDesc(d);
        const g = d.suggested_mapping;
        setSplit(!g.amount && !!(g.debit || g.credit));
        setMap(g);
      })
      .catch((e: Error) => setDescError(e.message));
  }, [csv]);

  const mapping = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of ["date", "name", "category", "notes"]) if (map[k]) m[k] = map[k]!;
    if (split) { if (map.debit) m.debit = map.debit; if (map.credit) m.credit = map.credit; }
    else if (map.amount) m.amount = map.amount;
    return m;
  }, [map, split]);
  const ready = !!(desc && accountId && mapping.date && mapping.name && (mapping.amount || mapping.debit || mapping.credit));
  const body = (commit: boolean) => ({ csv, account_id: accountId, mapping, date_format: dateFormat, expense_sign: expenseSign, skip_duplicates: skipDupes, create_categories: createCats, commit });

  // Step 3: live dry-run whenever the settings change
  useEffect(() => {
    setPreview(null); setPreviewError(null);
    if (!ready) return;
    const t = setTimeout(() => {
      api<Preview>("/api/import", { method: "POST", body: body(false) }).then(setPreview).catch((e: Error) => setPreviewError(e.message));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, csv, accountId, JSON.stringify(mapping), dateFormat, expenseSign, skipDupes, createCats]);

  const run = useAction(() => api<Preview>("/api/import", { method: "POST", body: body(true) }), (r) => setResult(r));
  const reset = () => { setCsv(""); setFileName(""); setResult(null); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) return setDescError("That file is over 8 MB. Split it into smaller files.");
    setFileName(f.name);
    setCsv(await f.text());
  };

  if (result) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="page-title">Import</h1>
        <section className="card space-y-3 p-6 text-center">
          <div className="text-4xl">✓</div>
          <h2 className="text-lg font-semibold">Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}</h2>
          <p className="muted text-sm">
            Added to {result.account}
            {result.duplicates > 0 && ` · ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped`}
            {result.error_count > 0 && ` · ${result.error_count} row${result.error_count === 1 ? "" : "s"} couldn't be read`}
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Link to="/transactions" className="btn btn-primary">View transactions</Link>
            <button className="btn" onClick={reset}>Import another file</button>
          </div>
        </section>
      </div>
    );
  }

  const colSelect = (key: string, label: string, optional = false) => (
    <Field label={label + (optional ? " (optional)" : "")}>
      <select className="input" value={map[key] ?? ""} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        <option value="">{optional ? "— none —" : "Choose column…"}</option>
        {desc!.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="max-w-4xl space-y-8 sm:space-y-10">
      <div>
        <div className="flex items-center gap-3"><Link to="/settings" className="icon-btn" aria-label="Back to settings"><Icon name="chevronLeft" /></Link><h1 className="page-title">Import transactions</h1></div>
      </div>

      <section className="card space-y-4 p-5">
        <h2 className="section-title">1 · File and account</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Import into">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </Field>
          <Field label="CSV file" hint={fileName ? `Loaded ${fileName}` : undefined}>
            <input className="input" type="file" accept=".csv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </Field>
        </div>
        <details className="text-sm">
          <summary className="muted cursor-pointer">…or paste CSV text</summary>
          <textarea className="input mt-2 font-mono text-xs" rows={5} placeholder={"Date,Description,Amount\n2026-01-05,Coffee,-3.20"} value={fileName ? "" : csv} onChange={(e) => { setFileName(""); setCsv(e.target.value); }} />
        </details>
        <ErrorNote error={descError ? new Error(descError) : null} />
      </section>

      {desc && (
        <section className="card space-y-4 p-5">
          <div className="flex items-baseline justify-between"><h2 className="section-title">2 · Match the columns</h2><span className="muted text-xs">{desc.row_count} rows found</span></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {colSelect("date", "Date")}
            {colSelect("name", "Description")}
            {split ? <>{colSelect("debit", "Money out / debit")}{colSelect("credit", "Money in / credit")}</> : colSelect("amount", "Amount")}
            {colSelect("category", "Category", true)}
            {colSelect("notes", "Notes", true)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amounts are in…">
              <select className="input" value={split ? "split" : "one"} onChange={(e) => setSplit(e.target.value === "split")}>
                <option value="one">One column (+ and −)</option><option value="split">Separate debit and credit columns</option>
              </select>
            </Field>
            <Field label="Date format"><select className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>{DATE_FORMATS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></Field>
            {!split && (
              <Field label="In this file, spending is…" hint="Most banks export money going out as negative.">
                <select className="input" value={expenseSign} onChange={(e) => setExpenseSign(e.target.value as "negative" | "positive")}>
                  <option value="negative">Negative (−12.50)</option><option value="positive">Positive (12.50)</option>
                </select>
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} /> Skip rows already in this account</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={createCats} onChange={(e) => setCreateCats(e.target.checked)} /> Create categories that don't exist yet</label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50 dark:bg-gray-800/50">{desc.headers.map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{desc.sample.map((r, i) => <tr key={i} className="border-t border-gray-100 dark:border-gray-800">{desc.headers.map((_, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5">{r[j]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {desc && (
        <section className="card space-y-4 p-5">
          <h2 className="section-title">3 · Review</h2>
          {!ready ? <Empty>Choose the date, description and amount columns to see a preview.</Empty>
            : previewError ? <ErrorNote error={new Error(previewError)} />
            : !preview ? <Empty>Checking…</Empty>
            : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><div className="muted text-xs">Will import</div><div className="text-xl font-semibold tabular-nums">{preview.to_import}</div></div>
                  <div><div className="muted text-xs">Duplicates skipped</div><div className="text-xl font-semibold tabular-nums">{preview.duplicates}</div></div>
                  <div><div className="muted text-xs">Money out</div><div className="text-xl font-semibold tabular-nums">{money(preview.expense, preview.currency)}</div></div>
                  <div><div className="muted text-xs">Money in</div><div className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(preview.income, preview.currency)}</div></div>
                </div>
                {preview.error_count > 0 && (
                  <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
                    <div className="font-medium text-amber-800 dark:text-amber-300">{preview.error_count} row{preview.error_count === 1 ? "" : "s"} will be skipped</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-800/90 dark:text-amber-300/90">
                      {preview.errors.slice(0, 6).map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
                      {preview.error_count > 6 && <li>…and {preview.error_count - 6} more</li>}
                    </ul>
                  </div>
                )}
                {preview.unknown_categories.length > 0 && (
                  <p className="muted text-sm">{createCats ? "New categories to create" : "Not matched, left uncategorized"}: {preview.unknown_categories.join(", ")}</p>
                )}
                {preview.preview.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 dark:border-gray-800"><th className="th">Date</th><th className="th">Description</th><th className="th hidden sm:table-cell">Category</th><th className="th text-right">Amount</th></tr></thead>
                      <tbody>
                        {preview.preview.map((p, i) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0 dark:border-gray-800/60">
                            <td className="muted whitespace-nowrap td">{fmtDate(p.date, { day: "numeric", month: "short", year: "2-digit" })}</td>
                            <td className="td">{p.name}</td>
                            <td className={cx("hidden td sm:table-cell", !p.category && "muted")}>{p.category || "—"}</td>
                            <td className="whitespace-nowrap td text-right font-medium"><Amount amount={p.amount} currency={preview.currency} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.to_import > preview.preview.length && <p className="muted px-3 pt-2 text-xs">Showing the first {preview.preview.length} of {preview.to_import}.</p>}
                  </div>
                )}
                <ErrorNote error={run.error} />
                <div className="flex items-center justify-between">
                  <button className="btn btn-ghost" onClick={reset}>Start over</button>
                  <button className="btn btn-primary" disabled={run.isPending || preview.to_import === 0} onClick={() => run.mutate()}>
                    {run.isPending ? "Importing…" : preview.to_import === 0 ? "Nothing to import" : `Import ${preview.to_import} transaction${preview.to_import === 1 ? "" : "s"} into ${preview.account}`}
                  </button>
                </div>
              </>
            )}
        </section>
      )}
    </div>
  );
}
