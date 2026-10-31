import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { dueDates } from "../recurring.js";
import { HttpError } from "../util.js";
import { loadRecurring } from "./recurring.js";

/** Day-by-day spending for one month, in the home currency. Transfers and excluded entries are left out, as in budgets. */
export async function calendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar/:month", async (req) => {
    const { month } = req.params as { month: string };
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Month must be YYYY-MM");
    const [y, m] = month.split("-").map(Number) as [number, number];
    const start = `${month}-01`;
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const shift = (n: number) => {
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    };

    const rows = await query<{ date: string; category_id: string | null; name: string | null; color: string | null; icon: string | null; spent: number; income: number; n: number }>(
      `SELECT e.date::text AS date, t.category_id, c.name, c.color, c.lucide_icon AS icon,
              COALESCE(sum(CASE WHEN e.amount > 0 THEN e.amount * ${fxRate("fx")} END), 0) AS spent,
              COALESCE(sum(CASE WHEN e.amount < 0 THEN -e.amount * ${fxRate("fx")} END), 0) AS income,
              count(*)::int AS n
       FROM account_entries e
       JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
       JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
       LEFT JOIN categories c ON c.id = t.category_id
       ${fxJoin("fx", "e.currency", "e.date", "$2")}
       WHERE e.date BETWEEN $3 AND $4 AND NOT e.excluded
         AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)
       GROUP BY e.date, t.category_id, c.name, c.color, c.lucide_icon`,
      [req.user.familyId, req.user.currency, start, end],
    );

    const byDay = new Map<string, { date: string; spent: number; income: number; count: number; categories: { name: string; color: string; icon: string | null; amount: number }[] }>();
    for (const r of rows) {
      const d = byDay.get(r.date) ?? { date: r.date, spent: 0, income: 0, count: 0, categories: [] };
      d.spent += r.spent;
      d.income += r.income;
      d.count += r.n;
      if (r.spent > 0) d.categories.push({ name: r.name ?? "Uncategorized", color: r.color ?? "#9ca3af", icon: r.icon, amount: r.spent });
      byDay.set(r.date, d);
    }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const d of days) d.categories.sort((a, b) => b.amount - a.amount);

    // bills still to come: expected dates of active recurring items that fall in this month and have no entry yet
    const upcoming = (await loadRecurring(req.user.familyId, req.user.currency))
      .filter((r) => r.active)
      .flatMap((r) => dueDates(r, start, end).filter((d) => d > r.last_date).map((date) => ({ date, name: r.name, amount: r.amount, direction: r.direction })))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalSpent = days.reduce((s, d) => s + d.spent, 0);
    const spendDays = days.filter((d) => d.spent > 0);
    const biggest = spendDays.reduce<(typeof days)[number] | null>((b, d) => (!b || d.spent > b.spent ? d : b), null);
    return {
      month, prev_month: shift(-1), next_month: shift(1), currency: req.user.currency,
      days,
      upcoming,
      total_spent: totalSpent,
      total_income: days.reduce((s, d) => s + d.income, 0),
      spend_days: spendDays.length,
      biggest_day: biggest ? { date: biggest.date, spent: biggest.spent } : null,
    };
  });
}
