import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { addDays, today } from "../util.js";
import { periodTotals } from "./budgets.js";

const PERIOD_DAYS: Record<string, number | null> = {
  "7d": 7, "30d": 30, "90d": 90, "365d": 365, all: null,
  // values stored in users.default_period by the original app
  last_7_days: 7, last_30_days: 30, last_365_days: 365, last_day: 1,
};

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/dashboard", async (req) => {
    const fam = req.user.familyId;
    const cur = req.user.currency;
    const key = String((req.query as any).period ?? "30d");
    const days = PERIOD_DAYS[key] === undefined ? 30 : PERIOD_DAYS[key];
    const end = today();
    const from = days === null ? "1900-01-01" : addDays(end, -days);

    // One point per day, adding up EVERY account. Balance rows are only written up to the day an account was last recalculated,
    // so an account with no row on a day still holds its latest earlier balance (otherwise it drops out of that day's total).
    const series = await query<{ date: string; assets: number; liabilities: number }>(
      `WITH accts AS (SELECT a.id, a.classification FROM accounts a WHERE a.family_id = $1 AND a.is_active),
            span AS (SELECT GREATEST($3::date, min(b.date)) AS d0 FROM account_balances b JOIN accts ON accts.id = b.account_id),
            days AS (SELECT d::date AS date FROM span, generate_series(span.d0, $4::date, interval '1 day') d)
       SELECT days.date::text AS date,
              COALESCE(sum(CASE WHEN a.classification = 'asset' THEN bal.balance * ${fxRate("fx")} END), 0) AS assets,
              COALESCE(sum(CASE WHEN a.classification = 'liability' THEN bal.balance * ${fxRate("fx")} END), 0) AS liabilities
       FROM days
       CROSS JOIN accts a
       JOIN LATERAL (SELECT b.balance, b.currency FROM account_balances b WHERE b.account_id = a.id AND b.date <= days.date ORDER BY b.date DESC LIMIT 1) bal ON true
       ${fxJoin("fx", "bal.currency", "days.date", "$2")}
       GROUP BY days.date ORDER BY days.date`,
      [fam, cur, from, end],
    );
    const all = series.map((s) => ({ date: s.date, assets: s.assets, liabilities: s.liabilities, net_worth: s.assets - s.liabilities }));
    const first = all[0];
    const last = all[all.length - 1];
    // a chart can't show more than a couple of hundred points: thin long ranges (keeps the last point exact)
    const step = Math.ceil(all.length / 150);
    const points = step > 1 ? all.filter((_, i) => i % step === 0 || i === all.length - 1) : all;

    const byType = await query<{ type: string; classification: string; total: number }>(
      `SELECT a.accountable_type AS type, a.classification, sum(a.balance * ${fxRate("fx")}) AS total
       FROM accounts a ${fxJoin("fx", "a.currency", "current_date", "$2")}
       WHERE a.family_id = $1 AND a.is_active GROUP BY 1, 2 ORDER BY 3 DESC`,
      [fam, cur],
    );

    const totals = await periodTotals(fam, cur, from === "1900-01-01" ? (first?.date ?? end) : from, end);
    const cats = await query<{ id: string; name: string; color: string; lucide_icon: string }>("SELECT id, name, color, lucide_icon FROM categories WHERE family_id = $1", [fam]);
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const spendingByCategory = totals
      .filter((t) => t.spent > 0)
      .map((t) => ({
        category_id: t.category_id,
        name: t.category_id ? (catMap.get(t.category_id)?.name ?? "Unknown") : "Uncategorized",
        color: t.category_id ? (catMap.get(t.category_id)?.color ?? "#9ca3af") : "#9ca3af",
        icon: t.category_id ? (catMap.get(t.category_id)?.lucide_icon ?? null) : null,
        amount: t.spent,
      }))
      .sort((a, b) => b.amount - a.amount);

    const recent = await query<any>(
      `SELECT e.id, e.date::text, e.name, e.amount, e.currency, a.name AS account_name, c.name AS category_name, c.color AS category_color, c.lucide_icon AS category_icon,
              EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id) AS is_transfer
       FROM account_entries e
       JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
       JOIN account_transactions t ON t.id = e.entryable_id AND e.entryable_type = 'Account::Transaction'
       LEFT JOIN categories c ON c.id = t.category_id
       ORDER BY e.date DESC, e.created_at DESC LIMIT 8`,
      [fam],
    );

    return {
      currency: cur,
      period: key,
      net_worth: {
        current: last?.net_worth ?? 0,
        change: last && first ? last.net_worth - first.net_worth : 0,
        assets: last?.assets ?? 0,
        liabilities: last?.liabilities ?? 0,
      },
      series: points,
      by_type: byType,
      cashflow: {
        income: totals.reduce((s, t) => s + t.income, 0),
        expenses: totals.reduce((s, t) => s + t.spent, 0),
      },
      spending_by_category: spendingByCategory,
      recent,
    };
  });
}
