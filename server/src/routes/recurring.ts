import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { detectRecurring, type Recurring } from "../recurring.js";
import { addDays, today } from "../util.js";

const LOOKBACK_DAYS = 548; // about 18 months: enough for a yearly charge to show up twice

/** Repeating charges and deposits found in the transaction history (read-only, nothing is stored). Transfers and excluded entries are left out. */
export async function loadRecurring(familyId: string, currency: string): Promise<Recurring[]> {
  const now = today();
  const rows = await query<{ date: string; amount: number; name: string; merchant: string | null }>(
    `SELECT e.date::text AS date, e.amount * ${fxRate("fx")} AS amount, e.name, m.name AS merchant
     FROM account_entries e
     JOIN accounts a ON a.id = e.account_id AND a.family_id = $1 AND a.is_active
     JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
     LEFT JOIN merchants m ON m.id = t.merchant_id
     ${fxJoin("fx", "e.currency", "e.date", "$2")}
     WHERE e.date >= $3 AND e.date <= $4 AND NOT e.excluded
       AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)`,
    [familyId, currency, addDays(now, -LOOKBACK_DAYS), now],
  );
  return detectRecurring(rows, now);
}

export async function recurringRoutes(app: FastifyInstance) {
  app.get("/api/recurring", async (req) => {
    const items = await loadRecurring(req.user.familyId, req.user.currency);
    const active = items.filter((i) => i.active);
    const sum = (dir: Recurring["direction"]) => active.filter((i) => i.direction === dir).reduce((s, i) => s + i.monthly, 0);
    return {
      currency: req.user.currency,
      monthly_expenses: sum("expense"),
      monthly_income: sum("income"),
      items,
    };
  });
}
