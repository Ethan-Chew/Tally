import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { NOW, one, query, tx } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { recomputeAccount } from "../balances.js";
import { HttpError, isoDate, parse, uuid } from "../util.js";
import { ownedAccount } from "./accounts.js";

/**
 * Entries are the original app's `account_entries` rows, a delegated type over
 * transactions / valuations / trades. Sign convention: amount > 0 is an outflow
 * (expense, or more debt on a liability); amount < 0 is an inflow (income).
 */

const FROM = `
  FROM account_entries e
  JOIN accounts a ON a.id = e.account_id
  LEFT JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  LEFT JOIN transfers tr ON tr.inflow_transaction_id = t.id OR tr.outflow_transaction_id = t.id
  LEFT JOIN account_trades tt ON e.entryable_type = 'Account::Trade' AND tt.id = e.entryable_id
  LEFT JOIN securities s ON s.id = tt.security_id`;

const listQuery = z.object({
  account_id: uuid.optional(),
  category_id: z.union([uuid, z.literal("none")]).optional(),
  merchant_id: uuid.optional(),
  tag_id: uuid.optional(),
  q: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  kind: z.enum(["transaction", "valuation", "trade", "all"]).default("transaction"),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const TYPE_BY_KIND = {
  transaction: "Account::Transaction",
  valuation: "Account::Valuation",
  trade: "Account::Trade",
} as const;

const txFields = {
  account_id: uuid,
  date: isoDate,
  name: z.string().trim().min(1),
  amount: z.number().positive(), // always positive; `type` decides the sign
  type: z.enum(["expense", "income"]),
  category_id: uuid.nullish(),
  merchant_id: uuid.nullish(),
  merchant_name: z.string().trim().min(1).nullish(), // creates the merchant if it doesn't exist
  tag_ids: z.array(uuid).optional(),
  notes: z.string().nullish(),
  excluded: z.boolean().optional(),
};

async function resolveMerchant(c: PoolClient, familyId: string, id?: string | null, name?: string | null) {
  if (id) return id;
  if (!name) return null;
  const found = await one<{ id: string }>("SELECT id FROM merchants WHERE family_id = $1 AND lower(name) = lower($2)", [familyId, name], c);
  if (found) return found.id;
  const created = await one<{ id: string }>(
    `INSERT INTO merchants (family_id, name, color, created_at, updated_at) VALUES ($1, $2, '#e99537', ${NOW}, ${NOW}) RETURNING id`,
    [familyId, name],
    c,
  );
  return created!.id;
}

async function setTags(c: PoolClient, transactionId: string, tagIds: string[]) {
  await query("DELETE FROM taggings WHERE taggable_type = 'Account::Transaction' AND taggable_id = $1", [transactionId], c);
  if (tagIds.length) {
    await query(
      `INSERT INTO taggings (tag_id, taggable_type, taggable_id, created_at, updated_at)
       SELECT unnest($1::uuid[]), 'Account::Transaction', $2, ${NOW}, ${NOW}`,
      [tagIds, transactionId],
      c,
    );
  }
}

export async function entryRoutes(app: FastifyInstance) {
  app.get("/api/entries", async (req) => {
    const f = parse(listQuery, req.query);
    const fam = req.user.familyId;
    const params: unknown[] = [fam, req.user.currency];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    const where = ["a.family_id = $1"];
    if (f.kind !== "all") where.push(`e.entryable_type = ${p(TYPE_BY_KIND[f.kind])}`);
    if (f.account_id) where.push(`e.account_id = ${p(f.account_id)}`);
    if (f.category_id === "none") where.push("t.id IS NOT NULL AND t.category_id IS NULL");
    else if (f.category_id) where.push(`t.category_id = ${p(f.category_id)}`);
    if (f.merchant_id) where.push(`t.merchant_id = ${p(f.merchant_id)}`);
    if (f.tag_id) where.push(`EXISTS (SELECT 1 FROM taggings g WHERE g.taggable_id = t.id AND g.taggable_type = 'Account::Transaction' AND g.tag_id = ${p(f.tag_id)})`);
    if (f.q) {
      const like = p(`%${f.q}%`);
      where.push(`(e.name ILIKE ${like} OR e.notes ILIKE ${like} OR m.name ILIKE ${like} OR c.name ILIKE ${like})`);
    }
    if (f.from) where.push(`e.date >= ${p(f.from)}`);
    if (f.to) where.push(`e.date <= ${p(f.to)}`);
    if (f.type === "income") where.push("e.amount < 0 AND tr.id IS NULL");
    if (f.type === "expense") where.push("e.amount > 0 AND tr.id IS NULL");
    if (f.type === "transfer") where.push("tr.id IS NOT NULL");
    const W = where.join(" AND ");
    const fx = fxJoin("fx", "e.currency", "e.date", "$2");

    // The count/sums scan every matching row, so only the first page pays for them; later pages reuse the client's copy.
    const totals = f.page > 1 ? null : await one<any>(
      `SELECT count(*)::int AS total,
              COALESCE(sum(CASE WHEN e.amount < 0 AND tr.id IS NULL AND NOT e.excluded THEN -e.amount * ${fxRate("fx")} END), 0) AS income,
              COALESCE(sum(CASE WHEN e.amount > 0 AND tr.id IS NULL AND NOT e.excluded THEN  e.amount * ${fxRate("fx")} END), 0) AS expense
       ${FROM} ${fx} WHERE ${W}`,
      params,
    );
    const rows = await query<any>(
      `SELECT e.id, e.entryable_type, e.entryable_id, e.account_id, a.name AS account_name, e.date::text, e.name,
              e.amount, e.currency, e.amount * ${fxRate("fx")} AS amount_converted, e.notes, e.excluded,
              t.category_id, c.name AS category_name, c.color AS category_color, c.lucide_icon AS category_icon,
              t.merchant_id, m.name AS merchant_name,
              tr.id AS transfer_id, tr.status AS transfer_status,
              tt.qty, tt.price, s.ticker,
              COALESCE((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) ORDER BY tg.name)
                        FROM taggings g JOIN tags tg ON tg.id = g.tag_id
                        WHERE g.taggable_id = t.id AND g.taggable_type = 'Account::Transaction'), '[]') AS tags
       ${FROM} ${fx} WHERE ${W}
       ORDER BY e.date DESC, e.created_at DESC, e.id
       LIMIT ${p(f.per_page)} OFFSET ${p((f.page - 1) * f.per_page)}`,
      params,
    );
    return { rows, total: totals?.total ?? null, income: totals?.income ?? null, expense: totals?.expense ?? null, page: f.page, per_page: f.per_page, currency: req.user.currency };
  });

  app.post("/api/entries", async (req) => {
    const b = parse(z.object(txFields), req.body);
    const acct = await ownedAccount(req.user.familyId, b.account_id);
    return tx(async (c) => {
      const merchantId = await resolveMerchant(c, req.user.familyId, b.merchant_id, b.merchant_name);
      const t = await one<{ id: string }>(
        `INSERT INTO account_transactions (category_id, merchant_id, created_at, updated_at) VALUES ($1, $2, ${NOW}, ${NOW}) RETURNING id`,
        [b.category_id ?? null, merchantId],
        c,
      );
      const e = await one<{ id: string }>(
        `INSERT INTO account_entries (account_id, entryable_type, entryable_id, amount, currency, date, name, notes, excluded, created_at, updated_at)
         VALUES ($1, 'Account::Transaction', $2, $3, $4, $5, $6, $7, $8, ${NOW}, ${NOW}) RETURNING id`,
        [b.account_id, t!.id, b.type === "expense" ? b.amount : -b.amount, acct.currency, b.date, b.name, b.notes ?? null, b.excluded ?? false],
        c,
      );
      if (b.tag_ids?.length) await setTags(c, t!.id, b.tag_ids);
      await recomputeAccount(c, b.account_id);
      return { id: e!.id };
    });
  });

  app.patch("/api/entries/:id", async (req) => {
    const { id } = req.params as { id: string };
    const e = await one<any>(
      `SELECT e.*, a.family_id FROM account_entries e JOIN accounts a ON a.id = e.account_id WHERE e.id = $1`,
      [id],
    );
    if (!e || e.family_id !== req.user.familyId) throw new HttpError(404, "Entry not found");

    if (e.entryable_type === "Account::Valuation") {
      const b = parse(z.object({ date: isoDate.optional(), amount: z.number().optional(), name: z.string().trim().min(1).optional() }), req.body);
      await tx(async (c) => {
        await query(
          `UPDATE account_entries SET date = COALESCE($2, date), amount = COALESCE($3, amount), name = COALESCE($4, name), updated_at = ${NOW} WHERE id = $1`,
          [id, b.date ?? null, b.amount ?? null, b.name ?? null],
          c,
        );
        await recomputeAccount(c, e.account_id);
      });
      return { ok: true };
    }
    if (e.entryable_type !== "Account::Transaction") throw new HttpError(400, "Only transactions and valuations can be edited");

    const b = parse(z.object(txFields).partial(), req.body);
    await tx(async (c) => {
      const targetAccount = b.account_id ?? e.account_id;
      const acct = b.account_id ? await ownedAccount(req.user.familyId, b.account_id) : null;
      let amount: number | null = null;
      if (b.amount !== undefined || b.type !== undefined) {
        const type = b.type ?? (e.amount > 0 ? "expense" : "income");
        const abs = b.amount ?? Math.abs(e.amount);
        amount = type === "expense" ? abs : -abs;
      }
      await query(
        `UPDATE account_entries SET account_id = $2, currency = COALESCE($3, currency), date = COALESCE($4, date), name = COALESCE($5, name),
                amount = COALESCE($6, amount), notes = CASE WHEN $7 THEN $8 ELSE notes END, excluded = COALESCE($9, excluded), updated_at = ${NOW}
         WHERE id = $1`,
        [id, targetAccount, acct?.currency ?? null, b.date ?? null, b.name ?? null, amount, "notes" in b, b.notes ?? null, b.excluded ?? null],
        c,
      );
      if ("category_id" in b || "merchant_id" in b || "merchant_name" in b) {
        const merchantId = "merchant_id" in b || "merchant_name" in b ? await resolveMerchant(c, req.user.familyId, b.merchant_id, b.merchant_name) : undefined;
        await query(
          `UPDATE account_transactions SET category_id = CASE WHEN $2 THEN $3::uuid ELSE category_id END,
                  merchant_id = CASE WHEN $4 THEN $5::uuid ELSE merchant_id END, updated_at = ${NOW} WHERE id = $1`,
          [e.entryable_id, "category_id" in b, b.category_id ?? null, merchantId !== undefined, merchantId ?? null],
          c,
        );
      }
      if (b.tag_ids) await setTags(c, e.entryable_id, b.tag_ids);
      await recomputeAccount(c, e.account_id);
      if (targetAccount !== e.account_id) await recomputeAccount(c, targetAccount);
    });
    return { ok: true };
  });

  app.delete("/api/entries/:id", async (req) => {
    const { id } = req.params as { id: string };
    await tx(async (c) => deleteEntries(c, req.user.familyId, [id]));
    return { ok: true };
  });

  app.post("/api/entries/bulk-delete", async (req) => {
    const b = parse(z.object({ ids: z.array(uuid).min(1).max(500) }), req.body);
    await tx(async (c) => deleteEntries(c, req.user.familyId, b.ids));
    return { ok: true };
  });

  app.post("/api/entries/bulk-update", async (req) => {
    const b = parse(z.object({ ids: z.array(uuid).min(1).max(500), category_id: uuid.nullish(), excluded: z.boolean().optional() }), req.body);
    await tx(async (c) => {
      const rows = await query<{ entryable_id: string; account_id: string }>(
        `SELECT e.entryable_id, e.account_id FROM account_entries e JOIN accounts a ON a.id = e.account_id
         WHERE e.id = ANY($1::uuid[]) AND a.family_id = $2 AND e.entryable_type = 'Account::Transaction'`,
        [b.ids, req.user.familyId],
        c,
      );
      if (!rows.length) return;
      if ("category_id" in b) {
        await query(`UPDATE account_transactions SET category_id = $2, updated_at = ${NOW} WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.entryable_id), b.category_id ?? null], c);
      }
      if (b.excluded !== undefined) {
        await query(`UPDATE account_entries SET excluded = $2, updated_at = ${NOW} WHERE id = ANY($1::uuid[])`, [b.ids, b.excluded], c);
      }
      for (const a of new Set(rows.map((r) => r.account_id))) await recomputeAccount(c, a);
    });
    return { ok: true };
  });
}

/** Deletes entries (plus their delegated rows, taggings, and the other half of any transfer), then recomputes balances. */
export async function deleteEntries(c: PoolClient, familyId: string, ids: string[]) {
  let entries = await query<{ id: string; account_id: string; entryable_type: string; entryable_id: string }>(
    `SELECT e.id, e.account_id, e.entryable_type, e.entryable_id FROM account_entries e
     JOIN accounts a ON a.id = e.account_id WHERE e.id = ANY($1::uuid[]) AND a.family_id = $2`,
    [ids, familyId],
    c,
  );
  if (!entries.length) throw new HttpError(404, "Entry not found");

  // a transfer is a pair: deleting one side removes both
  const txIds = entries.filter((e) => e.entryable_type === "Account::Transaction").map((e) => e.entryable_id);
  if (txIds.length) {
    const partners = await query<{ id: string }>(
      `SELECT e.id FROM transfers tr
       JOIN account_entries e ON e.entryable_id IN (tr.inflow_transaction_id, tr.outflow_transaction_id) AND e.entryable_type = 'Account::Transaction'
       WHERE tr.inflow_transaction_id = ANY($1::uuid[]) OR tr.outflow_transaction_id = ANY($1::uuid[])`,
      [txIds],
      c,
    );
    const have = new Set(entries.map((e) => e.id));
    const extra = partners.map((p) => p.id).filter((id) => !have.has(id));
    if (extra.length) {
      entries = entries.concat(
        await query<any>("SELECT id, account_id, entryable_type, entryable_id FROM account_entries WHERE id = ANY($1::uuid[])", [extra], c),
      );
    }
  }

  const allTx = entries.filter((e) => e.entryable_type === "Account::Transaction").map((e) => e.entryable_id);
  if (allTx.length) {
    await query("DELETE FROM taggings WHERE taggable_type = 'Account::Transaction' AND taggable_id = ANY($1::uuid[])", [allTx], c);
    await query("DELETE FROM rejected_transfers WHERE inflow_transaction_id = ANY($1::uuid[]) OR outflow_transaction_id = ANY($1::uuid[])", [allTx], c);
  }
  await query("DELETE FROM account_entries WHERE id = ANY($1::uuid[])", [entries.map((e) => e.id)], c);
  const byTable: Record<string, string[]> = {};
  for (const e of entries) {
    const table = { "Account::Transaction": "account_transactions", "Account::Valuation": "account_valuations", "Account::Trade": "account_trades" }[e.entryable_type];
    if (table) (byTable[table] ??= []).push(e.entryable_id);
  }
  for (const [table, rowIds] of Object.entries(byTable)) {
    await query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [rowIds], c); // transfers cascade
  }
  for (const a of new Set(entries.map((e) => e.account_id))) await recomputeAccount(c, a);
}
