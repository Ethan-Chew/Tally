import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { isoDate, parse, round2 } from "../util.js";

const MAX_SERIES = 11; // plus one "Other" slice: twelve legend entries fit the donut's grid
const GREY = "#9ca3af";

// what each grouping selects and joins; transactions with several tags count once under each tag
const GROUPS = {
  category: { id: "c.id", name: "c.name", color: "c.color", join: "LEFT JOIN categories c ON c.id = t.category_id" },
  merchant: { id: "m.id", name: "m.name", color: "NULL", join: "LEFT JOIN merchants m ON m.id = t.merchant_id" },
  tag: {
    id: "tg.id", name: "tg.name", color: "tg.color",
    join: `LEFT JOIN taggings g ON g.taggable_id = t.id AND g.taggable_type = 'Account::Transaction'
           LEFT JOIN tags tg ON tg.id = g.tag_id`,
  },
} as const;

/** Spending or income by category, merchant or tag, month by month (read-only). Transfers and excluded entries are left out. */
export async function reportRoutes(app: FastifyInstance) {
  app.get("/api/reports", async (req) => {
    const q = parse(
      z.object({ from: isoDate, to: isoDate, group: z.enum(["category", "merchant", "tag"]).default("category"), kind: z.enum(["expense", "income"]).default("expense") }),
      req.query,
    );
    const g = GROUPS[q.group];
    const sign = q.kind === "expense" ? "e.amount > 0" : "e.amount < 0";
    const rows = await query<{ month: string; id: string | null; name: string | null; color: string | null; amount: number }>(
      `SELECT to_char(e.date, 'YYYY-MM') AS month, ${g.id}::text AS id, ${g.name} AS name, ${g.color} AS color,
              sum(abs(e.amount) * ${fxRate("fx")}) AS amount
       FROM account_entries e
       JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
       JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
       ${g.join}
       ${fxJoin("fx", "e.currency", "e.date", "$2")}
       WHERE e.date BETWEEN $3 AND $4 AND NOT e.excluded AND ${sign}
         AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)
       GROUP BY 1, 2, 3, 4`,
      [req.user.familyId, req.user.currency, q.from, q.to],
    );

    // headline numbers for the summary card, counted once per transaction (a tag grouping can list one under several tags)
    const [stats] = await query<{ n: number; largest: number | null; total: number | null }>(
      `SELECT count(*)::int AS n, max(abs(e.amount) * ${fxRate("fx")}) AS largest, sum(abs(e.amount) * ${fxRate("fx")}) AS total
       FROM account_entries e
       JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
       JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
       ${fxJoin("fx", "e.currency", "e.date", "$2")}
       WHERE e.date BETWEEN $3 AND $4 AND NOT e.excluded AND ${sign}
         AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id)`,
      [req.user.familyId, req.user.currency, q.from, q.to],
    );

    // every month in the range, so empty months still show as gaps in the chart
    const months: string[] = [];
    for (let d = new Date(q.from.slice(0, 7) + "-01T00:00:00Z"); d.toISOString().slice(0, 10) <= q.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
    const at = new Map(months.map((m, i) => [m, i]));

    const byKey = new Map<string, { id: string | null; name: string; color: string | null; total: number; values: number[] }>();
    for (const r of rows) {
      const k = r.id ?? "none";
      const s = byKey.get(k) ?? { id: r.id, name: r.name ?? (q.group === "tag" ? "Untagged" : q.group === "merchant" ? "No merchant" : "Uncategorized"), color: r.color, total: 0, values: months.map(() => 0) };
      const i = at.get(r.month);
      if (i !== undefined) s.values[i] = round2(s.values[i]! + r.amount);
      s.total += r.amount;
      byKey.set(k, s);
    }
    const all = [...byKey.values()].sort((a, b) => b.total - a.total);
    const head = all.slice(0, MAX_SERIES);
    const rest = all.slice(MAX_SERIES);
    const series = head.map((s) => ({ ...s, total: round2(s.total) }));
    if (rest.length) {
      series.push({ id: null, name: `Other (${rest.length})`, color: GREY, total: round2(rest.reduce((s, r) => s + r.total, 0)), values: months.map((_, i) => round2(rest.reduce((s, r) => s + r.values[i]!, 0))) });
    }
    return { currency: req.user.currency, from: q.from, to: q.to, group: q.group, kind: q.kind, months, series, total: round2(all.reduce((s, r) => s + r.total, 0)),
      summary: { count: stats?.n ?? 0, largest: round2(stats?.largest ?? 0), average: stats?.n ? round2((stats.total ?? 0) / stats.n) : 0, total: round2(stats?.total ?? 0) } };
  });
}
