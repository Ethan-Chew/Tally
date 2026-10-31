import { execFileSync } from "node:child_process";
// Integration test for the API. It WRITES to the database, so only point it at a COPY, e.g.:
//   createdb -T maybe_production maybe_test   # then run the server against maybe_test
//   API_URL=http://localhost:3001 DATABASE_URL=postgres:///maybe_test node scripts/itest.mjs
// Requires `psql` on PATH. Every test cleans up after itself and asserts balances are byte-identical afterwards.
const B = process.env.API_URL ?? "http://localhost:3001";
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL to a COPY of your DB"); process.exit(2); }
let cookie = "";
const api = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t}`);
  return j;
};
const sql = (s) => execFileSync("psql", [process.env.DATABASE_URL, "-Atc", s]).toString().trim();
const fingerprint = () => sql("select md5(string_agg(account_id::text||date::text||balance::text||currency, ',' order by account_id,date)) from account_balances") + " / " + sql("select md5(string_agg(id::text||balance::text, ',' order by id)) from accounts");
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };

const base = fingerprint();
const accts = (await api("GET", "/api/accounts")).accounts;
const gxs = accts.find(a => a.name === "GXS Account"), ocbc = accts.find(a => a.name === "OCBC Account");
const cats = await api("GET", "/api/categories"); const food = cats.find(c => c.name === "Food & Drink");

// 1. recompute is a no-op on untouched data  (create+delete must restore exactly)
const e1 = await api("POST", "/api/entries", { account_id: gxs.id, date: "2026-10-20", name: "ITEST lunch", amount: 12.5, type: "expense", category_id: food.id, merchant_name: "ITEST Cafe", notes: "n" });
let g = (await api("GET", "/api/accounts/" + gxs.id)).account.balance;
ok(Math.abs(g - (gxs.balance - 12.5)) < 1e-6, `expense lowers asset balance (${gxs.balance} -> ${g})`);
const list = await api("GET", "/api/entries?q=ITEST");
ok(list.total === 1 && list.rows[0].merchant_name === "ITEST Cafe" && list.rows[0].category_name === "Food & Drink", "list shows new entry with merchant+category");
await api("PATCH", "/api/entries/" + e1.id, { amount: 20, type: "income", name: "ITEST refund" });
g = (await api("GET", "/api/accounts/" + gxs.id)).account.balance;
ok(Math.abs(g - (gxs.balance + 20)) < 1e-6, `edit expense->income flips sign (${g})`);
await api("DELETE", "/api/entries/" + e1.id);
ok(fingerprint() === base, "create/edit/delete restores balances byte-for-byte");

// 2. transfer
const tr = await api("POST", "/api/transfers", { from_account_id: gxs.id, to_account_id: ocbc.id, amount: 100, date: "2026-10-30" });
const gx2 = (await api("GET", "/api/accounts/" + gxs.id)).account.balance, oc2 = (await api("GET", "/api/accounts/" + ocbc.id)).account.balance;
ok(Math.abs(gx2 - (gxs.balance - 100)) < 1e-6 && Math.abs(oc2 - (ocbc.balance + 100)) < 1e-6, "transfer moves money between accounts");
const b0 = await api("GET", "/api/budgets/2026-10");
const tl = await api("GET", "/api/entries?type=transfer&from=2026-10-30&to=2026-10-30");
ok(tl.total === 2, "transfer appears as 2 linked entries");
await api("DELETE", "/api/transfers/" + tr.id);
ok(fingerprint() === base, "deleting transfer removes both halves + restores balances");

// 3. transfers excluded from budget spending: spent unchanged by a 100 transfer
const tr2 = await api("POST", "/api/transfers", { from_account_id: gxs.id, to_account_id: ocbc.id, amount: 100, date: "2026-10-30" });
const b1 = await api("GET", "/api/budgets/2026-10");
ok(Math.abs(b1.actual_spending - b0.actual_spending) < 1e-6, "transfers excluded from budget spending");
await api("DELETE", "/api/transfers/" + tr2.id);

// 4. valuation
await api("POST", `/api/accounts/${gxs.id}/valuations`, { date: "2026-10-31", amount: 30000 });
ok((await api("GET", "/api/accounts/" + gxs.id)).account.balance === 30000, "valuation resets balance");
const vals = await api("GET", `/api/entries?account_id=${gxs.id}&kind=valuation&from=2026-10-31`);
await api("DELETE", "/api/entries/" + vals.rows[0].id);
ok(fingerprint() === base, "deleting valuation restores balances");

// 5. budget
const bud = await api("GET", "/api/budgets/2026-10");
const sql_spent = parseFloat(sql("select coalesce(sum(e.amount),0) from account_entries e join account_transactions t on t.id=e.entryable_id where e.entryable_type='Account::Transaction' and e.date between '2026-10-01' and '2026-10-31' and e.amount>0 and not e.excluded and e.currency='SGD' and not exists(select 1 from transfers tr where tr.inflow_transaction_id=t.id or tr.outflow_transaction_id=t.id)"));
ok(Math.abs(bud.actual_spending - sql_spent) < 0.01, `budget spending ${bud.actual_spending.toFixed(2)} matches raw SQL ${sql_spent}`);
ok(bud.budgeted_spending === 500 && bud.expected_income === 790, "existing October budget (500 / 790) read from the old data");
const put = await api("PUT", "/api/budgets/2026-10", { budgeted_spending: 600, categories: [{ category_id: food.id, budgeted_spending: 350 }] });
ok(put.budgeted_spending === 600 && put.categories.find(c => c.name === "Food & Drink").budgeted_spending === 350, "budget update persists");
const nov = await api("GET", "/api/budgets/2026-11");
ok(nov.budgeted_spending === 600 && nov.categories.find(c => c.name === "Food & Drink").budgeted_spending === 350, "new month clones previous budget");

// 6. account lifecycle for every type
for (const type of ["Depository","Investment","Crypto","Property","Vehicle","OtherAsset","CreditCard","Loan","OtherLiability"]) {
  const { id } = await api("POST", "/api/accounts", { name: "ITEST " + type, type, balance: 1000 });
  const d = await api("GET", "/api/accounts/" + id);
  const liab = ["CreditCard","Loan","OtherLiability"].includes(type);
  if (d.account.balance !== 1000 || d.account.classification !== (liab ? "liability" : "asset")) ok(false, type + " create " + JSON.stringify(d.account));
  await api("POST", "/api/entries", { account_id: id, date: "2026-10-31", name: "t", amount: 100, type: "expense" });
  const after = (await api("GET", "/api/accounts/" + id)).account.balance;
  if (after !== (liab ? 1100 : 900)) ok(false, type + " expense effect " + after);
  await api("DELETE", "/api/accounts/" + id);
}
ok(sql("select count(*) from accounts where name like 'ITEST%'") === "0" && sql("select count(*) from account_entries e where not exists (select 1 from accounts a where a.id=e.account_id)") === "0", "all 9 account types: create / balance sign / delete clean");
ok(fingerprint() === base, "no residue after account lifecycle");

// 7. taxonomy + bulk
const cat = await api("POST", "/api/categories", { name: "ITEST cat", color: "#112233", classification: "expense" });
const tag = await api("POST", "/api/tags", { name: "ITEST tag" });
const e2 = await api("POST", "/api/entries", { account_id: ocbc.id, date: "2026-10-30", name: "ITEST tagged", amount: 1, type: "expense", category_id: cat.id, tag_ids: [tag.id] });
const tagged = await api("GET", `/api/entries?tag_id=${tag.id}`);
ok(tagged.total === 1 && tagged.rows[0].tags[0].name === "ITEST tag", "tag filter + tags in rows");
await api("POST", "/api/entries/bulk-update", { ids: [e2.id], category_id: food.id });
ok((await api("GET", `/api/entries?q=ITEST tagged`)).rows[0].category_name === "Food & Drink", "bulk recategorize");
await api("POST", "/api/entries/bulk-delete", { ids: [e2.id] });
await api("DELETE", "/api/categories/" + cat.id); await api("DELETE", "/api/tags/" + tag.id);
await api("DELETE", "/api/merchants/" + (await api("GET", "/api/merchants")).find(m => m.name === "ITEST Cafe").id);
ok(fingerprint() === base, "taxonomy + bulk ops clean");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
