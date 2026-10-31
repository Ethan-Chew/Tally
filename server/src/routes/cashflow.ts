import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { addDays, isoDate, parse, round2 } from "../util.js";

type Node = { id: string; name: string; color: string; icon: string | null; amount: number };

const UNCAT = { id: "uncategorized", name: "Uncategorized", color: "#9ca3af", icon: null };

/** Net amount per category for a date range, home currency. Transfers and excluded entries are left out. Positive = money out. */
async function netByCategory(familyId: string, currency: string, from: string, to: string, group: "category" | "parent") {
  const rows = await query<{ id: string | null; name: string | null; color: string | null; icon: string | null; net: number }>(
    `SELECT COALESCE(${group === "parent" ? "p.id, c.id" : "c.id"})::text AS id,
            COALESCE(${group === "parent" ? "p.name, c.name" : "c.name"}) AS name,
            COALESCE(${group === "parent" ? "p.color, c.color" : "c.color"}) AS color,
            COALESCE(${group === "parent" ? "p.lucide_icon, c.lucide_icon" : "c.lucide_icon"}) AS icon,
            sum(e.amount * ${fxRate("fx")}) AS net
     FROM account_entries e
     JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
     JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories p ON p.id = c.parent_id
     ${fxJoin("fx", "e.currency", "e.date", "$2")}
     WHERE e.date BETWEEN $3 AND $4 AND NOT e.excluded
       AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)
     GROUP BY 1, 2, 3, 4`,
    [familyId, currency, from, to],
  );
  const income: Node[] = [];
  const expenses: Node[] = [];
  for (const r of rows) {
    const node = r.id ? { id: r.id, name: r.name ?? "Unknown", color: r.color ?? "#9ca3af", icon: r.icon } : UNCAT;
    // a category nets out: salary is money in, groceries money out, and a refund larger than the spend flips sides
    if (r.net < 0) income.push({ ...node, amount: round2(-r.net) });
    else if (r.net > 0) expenses.push({ ...node, amount: round2(r.net) });
  }
  const byAmount = (a: Node, b: Node) => b.amount - a.amount;
  return { income: income.sort(byAmount), expenses: expenses.sort(byAmount) };
}

const sum = (xs: Node[]) => xs.reduce((s, x) => s + x.amount, 0);
const totals = (income: Node[], expenses: Node[]) => {
  const i = sum(income);
  const e = sum(expenses);
  return { income: round2(i), expenses: round2(e), net: round2(i - e), savings_rate: i > 0 ? (i - e) / i : null };
};

/** Where money came from and where it went over a period, with the period just before it for comparison (read-only). */
export async function cashflowRoutes(app: FastifyInstance) {
  app.get("/api/cashflow", async (req) => {
    const q = parse(
      z.object({ from: isoDate, to: isoDate, group: z.enum(["category", "parent"]).default("parent") }),
      req.query,
    );
    const fam = req.user.familyId;
    const cur = req.user.currency;
    // the previous period is the same number of days straight before `from`
    const days = Math.max(1, Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86400000) + 1);
    const prevTo = addDays(q.from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));

    const now = await netByCategory(fam, cur, q.from, q.to, q.group);
    const before = await netByCategory(fam, cur, prevFrom, prevTo, q.group);
    return {
      currency: cur,
      from: q.from,
      to: q.to,
      group: q.group,
      ...now,
      totals: totals(now.income, now.expenses),
      previous: { from: prevFrom, to: prevTo, ...totals(before.income, before.expenses), expenses_by_category: before.expenses },
    };
  });
}
