import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, one, query, tx } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { HttpError, parse, today, uuid } from "../util.js";

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return { start, end, prev: shift(-1), next: shift(1) };
}

/** Spending/income for a date range in the family currency: no transfers, no excluded entries. Amount > 0 = spending. */
export async function periodTotals(familyId: string, currency: string, from: string, to: string) {
  const rows = await query<{ category_id: string | null; spent: number; income: number }>(
    `SELECT t.category_id,
            COALESCE(sum(CASE WHEN e.amount > 0 THEN e.amount * ${fxRate("fx")} END), 0) AS spent,
            COALESCE(sum(CASE WHEN e.amount < 0 THEN -e.amount * ${fxRate("fx")} END), 0) AS income
     FROM account_entries e
     JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
     JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
     ${fxJoin("fx", "e.currency", "e.date", "$2")}
     WHERE e.date BETWEEN $3 AND $4 AND NOT e.excluded
       AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)
     GROUP BY t.category_id`,
    [familyId, currency, from, to],
  );
  return rows;
}

/** Spending per day (home currency; no transfers / excluded entries). Used for the pace chart. */
async function dailySpending(familyId: string, currency: string, from: string, to: string) {
  return query<{ date: string; spent: number }>(
    `SELECT e.date::text AS date, sum(e.amount * ${fxRate("fx")}) AS spent
     FROM account_entries e
     JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
     JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
     ${fxJoin("fx", "e.currency", "e.date", "$2")}
     WHERE e.date BETWEEN $3 AND $4 AND e.amount > 0 AND NOT e.excluded
       AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)
     GROUP BY e.date ORDER BY e.date`,
    [familyId, currency, from, to],
  );
}

async function loadBudget(familyId: string, currency: string, month: string) {
  const { start, end, prev, next } = monthBounds(month);

  let budget = await one<any>("SELECT * FROM budgets WHERE family_id = $1 AND start_date = $2", [familyId, start]);
  if (!budget) {
    // a new month starts as a copy of the most recent earlier budget
    const prevBudget = await one<any>(
      "SELECT * FROM budgets WHERE family_id = $1 AND start_date < $2 ORDER BY start_date DESC LIMIT 1",
      [familyId, start],
    );
    budget = await one<any>(
      `INSERT INTO budgets (family_id, start_date, end_date, budgeted_spending, expected_income, currency, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${NOW}, ${NOW}) RETURNING *`,
      [familyId, start, end, prevBudget?.budgeted_spending ?? null, prevBudget?.expected_income ?? null, currency],
    );
    if (prevBudget) {
      await query(
        `INSERT INTO budget_categories (budget_id, category_id, budgeted_spending, currency, created_at, updated_at)
         SELECT $1, category_id, budgeted_spending, currency, ${NOW}, ${NOW} FROM budget_categories WHERE budget_id = $2`,
        [budget.id, prevBudget.id],
      );
    }
  }
  // make sure every expense category has a row (categories may have been added later)
  await query(
    `INSERT INTO budget_categories (budget_id, category_id, budgeted_spending, currency, created_at, updated_at)
     SELECT $1, c.id, 0, $3, ${NOW}, ${NOW} FROM categories c
     WHERE c.family_id = $2 AND c.classification = 'expense'
     ON CONFLICT (budget_id, category_id) DO NOTHING`,
    [budget.id, familyId, budget.currency],
  );

  const cats = await query<any>(
    `SELECT c.id AS category_id, c.name, c.color, c.lucide_icon, c.parent_id, bc.budgeted_spending
     FROM budget_categories bc JOIN categories c ON c.id = bc.category_id
     WHERE bc.budget_id = $1 AND c.classification = 'expense' ORDER BY c.name`,
    [budget.id],
  );
  const totals = await periodTotals(familyId, budget.currency, start, end);
  const daily = await dailySpending(familyId, budget.currency, start, end);
  const spentBy = new Map(totals.map((t) => [t.category_id, t.spent]));
  const categories = cats.map((c) => ({ ...c, actual_spending: spentBy.get(c.category_id) ?? 0 }));

  const allocated = categories.reduce((s, c) => s + c.budgeted_spending, 0);
  const actualSpending = totals.reduce((s, t) => s + t.spent, 0);
  const actualIncome = totals.reduce((s, t) => s + t.income, 0);
  const categorizedSpend = categories.reduce((s, c) => s + c.actual_spending, 0);
  const total = budget.budgeted_spending ?? allocated;

  return {
    id: budget.id,
    month,
    start_date: start,
    end_date: end,
    prev_month: prev,
    next_month: next,
    currency: budget.currency,
    budgeted_spending: total,
    budgeted_spending_set: budget.budgeted_spending !== null,
    expected_income: budget.expected_income ?? 0,
    allocated_spending: allocated,
    unallocated_spending: total - allocated,
    actual_spending: actualSpending,
    uncategorized_spending: actualSpending - categorizedSpend,
    actual_income: actualIncome,
    daily,
    categories,
  };
}

export async function budgetRoutes(app: FastifyInstance) {
  app.get("/api/budgets/:month", async (req) => {
    const { month } = req.params as { month: string };
    if (!monthRe.test(month)) throw new HttpError(400, "Month must be YYYY-MM");
    return loadBudget(req.user.familyId, req.user.currency, month);
  });

  app.put("/api/budgets/:month", async (req) => {
    const { month } = req.params as { month: string };
    if (!monthRe.test(month)) throw new HttpError(400, "Month must be YYYY-MM");
    const b = parse(
      z.object({
        budgeted_spending: z.number().min(0).nullish(),
        expected_income: z.number().min(0).nullish(),
        categories: z.array(z.object({ category_id: uuid, budgeted_spending: z.number().min(0) })).optional(),
      }),
      req.body,
    );
    const current = await loadBudget(req.user.familyId, req.user.currency, month); // ensures the row exists
    await tx(async (c) => {
      await query(
        `UPDATE budgets SET budgeted_spending = CASE WHEN $2 THEN $3::numeric ELSE budgeted_spending END,
                expected_income = CASE WHEN $4 THEN $5::numeric ELSE expected_income END, updated_at = ${NOW} WHERE id = $1`,
        [current.id, "budgeted_spending" in b, b.budgeted_spending ?? null, "expected_income" in b, b.expected_income ?? null],
        c,
      );
      for (const cat of b.categories ?? []) {
        await query(
          `UPDATE budget_categories SET budgeted_spending = $3, updated_at = ${NOW} WHERE budget_id = $1 AND category_id = $2`,
          [current.id, cat.category_id, cat.budgeted_spending],
          c,
        );
      }
    });
    return loadBudget(req.user.familyId, req.user.currency, month);
  });

  /** Last N months: budgeted vs. actual, for the history chart. Does not create budget rows. */
  app.get("/api/budgets", async (req) => {
    const n = Math.min(Number((req.query as any).months ?? 12) || 12, 36);
    const now = today();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1 - i, 1));
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const { start, end } = monthBounds(month);
      const b = await one<any>(
        `SELECT b.budgeted_spending, b.expected_income,
                (SELECT COALESCE(sum(bc.budgeted_spending), 0) FROM budget_categories bc WHERE bc.budget_id = b.id) AS allocated
         FROM budgets b WHERE b.family_id = $1 AND b.start_date = $2`,
        [req.user.familyId, start],
      );
      const totals = await periodTotals(req.user.familyId, req.user.currency, start, end);
      out.push({
        month,
        budgeted: b ? (b.budgeted_spending ?? b.allocated) : null,
        expected_income: b?.expected_income ?? null,
        spent: totals.reduce((s, t) => s + t.spent, 0),
        income: totals.reduce((s, t) => s + t.income, 0),
      });
    }
    return out;
  });
}
