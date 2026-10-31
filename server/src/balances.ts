import type { PoolClient } from "pg";
import { NOW, one, query } from "./db.js";
import { addDays, today } from "./util.js";

/**
 * Rebuilds `account_balances` for one account and refreshes `accounts.balance`.
 *
 * Rules (verified against every account in the original database, 0 mismatches):
 *  - the series starts at 0 on the day *before* the account's first entry
 *  - each day: balance -= outflows (assets) / += outflows (liabilities); amount > 0 is an outflow
 *  - a valuation entry on a day *replaces* the running balance
 *  - excluded entries still count toward the balance
 *  - trades don't change total balance (cash <-> holdings)
 */
export async function recomputeAccount(c: PoolClient, accountId: string): Promise<void> {
  const acct = await one<{ classification: string; currency: string; accountable_type: string }>(
    "SELECT classification, currency, accountable_type FROM accounts WHERE id = $1",
    [accountId],
    c,
  );
  if (!acct) return;

  const entries = await query<{ date: string; entryable_type: string; amount: number }>(
    "SELECT date::text, entryable_type, amount FROM account_entries WHERE account_id = $1 ORDER BY date",
    [accountId],
    c,
  );

  if (entries.length === 0) {
    await query("DELETE FROM account_balances WHERE account_id = $1", [accountId], c);
    await query(`UPDATE accounts SET balance = 0, cash_balance = 0, updated_at = ${NOW} WHERE id = $1`, [accountId], c);
    return;
  }

  const flow = new Map<string, number>();
  const valuation = new Map<string, number>();
  for (const e of entries) {
    if (e.entryable_type === "Account::Valuation") valuation.set(e.date, e.amount);
    else if (e.entryable_type === "Account::Transaction") flow.set(e.date, (flow.get(e.date) ?? 0) + e.amount);
  }

  const sign = acct.classification === "liability" ? 1 : -1;
  const start = addDays(entries[0]!.date, -1); // opening row: a 0 balance the day before the first entry
  const last = entries[entries.length - 1]!.date;
  const end = last > today() ? last : today();

  const dates: string[] = [];
  const balances: number[] = [];
  let bal = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    bal += sign * (flow.get(d) ?? 0);
    if (valuation.has(d)) bal = valuation.get(d)!;
    dates.push(d);
    balances.push(Math.round(bal * 10000) / 10000);
  }

  // Upsert (keeps existing cash_balance on investment accounts), then drop rows outside the new range.
  await query(
    `INSERT INTO account_balances (account_id, date, balance, cash_balance, currency, created_at, updated_at)
     SELECT $1, d, b, b, $4, ${NOW}, ${NOW} FROM unnest($2::date[], $3::numeric[]) AS t(d, b)
     ON CONFLICT (account_id, date, currency)
     DO UPDATE SET balance = EXCLUDED.balance, updated_at = ${NOW},
       cash_balance = CASE WHEN $5 THEN account_balances.cash_balance ELSE EXCLUDED.cash_balance END`,
    [accountId, dates, balances, acct.currency, acct.accountable_type === "Investment"],
    c,
  );
  await query(
    "DELETE FROM account_balances WHERE account_id = $1 AND NOT (date = ANY($2::date[]))",
    [accountId, dates],
    c,
  );

  // The account's current balance is as of today: future-dated entries must not move it.
  const todayIdx = dates.indexOf(today());
  const latest = todayIdx >= 0 ? balances[todayIdx]! : 0;
  await query(
    `UPDATE accounts SET balance = $2,
       cash_balance = CASE WHEN accountable_type = 'Investment' THEN cash_balance ELSE $2 END,
       updated_at = ${NOW} WHERE id = $1`,
    [accountId, latest],
    c,
  );
}
