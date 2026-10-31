import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, one, query, tx } from "../db.js";
import { fxJoin, fxRate } from "../fx.js";
import { recomputeAccount } from "../balances.js";
import { addDays, HttpError, isoDate, parse, today, uuid } from "../util.js";

/** accountable_type -> backing table (delegated type, as in the original schema) */
export const ACCOUNT_TYPES = {
  Depository: "depositories",
  Investment: "investments",
  Crypto: "cryptos",
  Property: "properties",
  Vehicle: "vehicles",
  OtherAsset: "other_assets",
  CreditCard: "credit_cards",
  Loan: "loans",
  OtherLiability: "other_liabilities",
} as const;

const typeEnum = z.enum(Object.keys(ACCOUNT_TYPES) as [keyof typeof ACCOUNT_TYPES, ...(keyof typeof ACCOUNT_TYPES)[]]);

export async function ownedAccount(familyId: string, id: string) {
  const a = await one<any>("SELECT * FROM accounts WHERE id = $1 AND family_id = $2", [id, familyId]);
  if (!a) throw new HttpError(404, "Account not found");
  return a;
}

export async function accountRoutes(app: FastifyInstance) {
  app.get("/api/accounts", async (req) => {
    const cur = req.user.currency;
    const rows = await query<any>(
      `SELECT a.id, a.name, a.accountable_type, a.subtype, a.classification, a.balance, a.currency, a.is_active,
              a.balance * ${fxRate("fx")} AS balance_converted,
              (SELECT b.balance FROM account_balances b WHERE b.account_id = a.id AND b.date <= current_date - 30 ORDER BY b.date DESC LIMIT 1) AS balance_30d_ago
       FROM accounts a ${fxJoin("fx", "a.currency", "current_date", "$2")}
       WHERE a.family_id = $1
       ORDER BY a.is_active DESC, a.classification, a.balance * ${fxRate("fx")} DESC`,
      [req.user.familyId, cur],
    );
    let assets = 0;
    let liabilities = 0;
    for (const r of rows) {
      if (!r.is_active) continue;
      if (r.classification === "asset") assets += r.balance_converted;
      else liabilities += r.balance_converted;
    }
    return { currency: cur, assets, liabilities, net_worth: assets - liabilities, accounts: rows };
  });

  app.get("/api/accounts/:id", async (req) => {
    const { id } = req.params as { id: string };
    const a = await ownedAccount(req.user.familyId, id);
    const series = await query<{ date: string; balance: number }>(
      "SELECT date::text, balance FROM account_balances WHERE account_id = $1 ORDER BY date",
      [id],
    );
    const holdings = await query<any>(
      `SELECT h.id, s.ticker, s.name, s.logo_url, h.qty, h.price, h.amount, h.currency, h.date::text
       FROM account_holdings h JOIN securities s ON s.id = h.security_id
       WHERE h.account_id = $1 AND h.date = (SELECT max(date) FROM account_holdings WHERE account_id = $1) AND h.qty > 0
       ORDER BY h.amount DESC`,
      [id],
    );
    const detail = await one<any>(
      `SELECT * FROM ${ACCOUNT_TYPES[a.accountable_type as keyof typeof ACCOUNT_TYPES]} WHERE id = $1`,
      [a.accountable_id],
    );
    return {
      account: {
        id: a.id, name: a.name, accountable_type: a.accountable_type, subtype: a.subtype,
        classification: a.classification, balance: a.balance, currency: a.currency, is_active: a.is_active,
      },
      details: detail ?? {},
      series,
      holdings,
    };
  });

  app.post("/api/accounts", async (req) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(1),
        type: typeEnum,
        subtype: z.string().trim().min(1).nullish(),
        balance: z.number().default(0),
        currency: z.string().length(3).optional(),
        date: isoDate.optional(),
      }),
      req.body,
    );
    const currency = (b.currency ?? req.user.currency).toUpperCase();
    return tx(async (c) => {
      const table = ACCOUNT_TYPES[b.type];
      const detail = await one<{ id: string }>(
        `INSERT INTO ${table} (created_at, updated_at) VALUES (${NOW}, ${NOW}) RETURNING id`,
        [],
        c,
      );
      // `classification` is a generated column derived from accountable_type, so it is never written.
      const acct = await one<{ id: string }>(
        `INSERT INTO accounts (family_id, name, accountable_type, accountable_id, subtype, balance, cash_balance, currency, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, 0, $6, true, ${NOW}, ${NOW}) RETURNING id`,
        [req.user.familyId, b.name, b.type, detail!.id, b.subtype ?? null, currency],
        c,
      );
      // Dated the day before by default: a valuation overrides that day's flows, so same-day transactions still count.
      await insertValuation(c, acct!.id, currency, b.date ?? addDays(today(), -1), b.balance, "Opening balance");
      await recomputeAccount(c, acct!.id);
      return { id: acct!.id };
    });
  });

  app.patch("/api/accounts/:id", async (req) => {
    const { id } = req.params as { id: string };
    await ownedAccount(req.user.familyId, id);
    const b = parse(
      z.object({ name: z.string().trim().min(1).optional(), subtype: z.string().nullish(), is_active: z.boolean().optional() }),
      req.body,
    );
    await query(
      `UPDATE accounts SET name = COALESCE($2, name), subtype = CASE WHEN $3 THEN $4 ELSE subtype END,
              is_active = COALESCE($5, is_active), updated_at = ${NOW} WHERE id = $1`,
      [id, b.name ?? null, "subtype" in b, b.subtype ?? null, b.is_active ?? null],
    );
    return { ok: true };
  });

  app.delete("/api/accounts/:id", async (req) => {
    const { id } = req.params as { id: string };
    const a = await ownedAccount(req.user.familyId, id);
    await tx(async (c) => {
      const txIds = (
        await query<{ entryable_id: string }>(
          "SELECT entryable_id FROM account_entries WHERE account_id = $1 AND entryable_type = 'Account::Transaction'",
          [id],
          c,
        )
      ).map((r) => r.entryable_id);
      if (txIds.length) {
        // transfers cascade from transactions; taggings/rejected_transfers are not FK-cascaded
        await query("DELETE FROM taggings WHERE taggable_type = 'Account::Transaction' AND taggable_id = ANY($1::uuid[])", [txIds], c);
        await query("DELETE FROM rejected_transfers WHERE inflow_transaction_id = ANY($1::uuid[]) OR outflow_transaction_id = ANY($1::uuid[])", [txIds], c);
      }
      for (const [type, table] of [
        ["Account::Transaction", "account_transactions"],
        ["Account::Valuation", "account_valuations"],
        ["Account::Trade", "account_trades"],
      ] as const) {
        const removed = await query<{ entryable_id: string }>(
          "DELETE FROM account_entries WHERE account_id = $1 AND entryable_type = $2 RETURNING entryable_id",
          [id, type],
          c,
        );
        if (removed.length) await query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [removed.map((r) => r.entryable_id)], c);
      }
      await query("DELETE FROM account_holdings WHERE account_id = $1", [id], c);
      await query("DELETE FROM accounts WHERE id = $1", [id], c); // balances cascade
      await query(`DELETE FROM ${ACCOUNT_TYPES[a.accountable_type as keyof typeof ACCOUNT_TYPES]} WHERE id = $1`, [a.accountable_id], c);
    });
    return { ok: true };
  });

  /** Set the balance of an account on a date (one valuation per date, upserted). */
  app.post("/api/accounts/:id/valuations", async (req) => {
    const { id } = req.params as { id: string };
    const a = await ownedAccount(req.user.familyId, id);
    const b = parse(z.object({ date: isoDate, amount: z.number() }), req.body);
    await tx(async (c) => {
      const existing = await one<{ id: string }>(
        "SELECT id FROM account_entries WHERE account_id = $1 AND entryable_type = 'Account::Valuation' AND date = $2",
        [id, b.date],
        c,
      );
      if (existing) {
        await query(`UPDATE account_entries SET amount = $2, updated_at = ${NOW} WHERE id = $1`, [existing.id, b.amount], c);
      } else {
        await insertValuation(c, id, a.currency, b.date, b.amount, "Balance update");
      }
      await recomputeAccount(c, id);
    });
    return { ok: true };
  });
}

export async function insertValuation(c: import("pg").PoolClient, accountId: string, currency: string, date: string, amount: number, name: string) {
  const v = await one<{ id: string }>(`INSERT INTO account_valuations (created_at, updated_at) VALUES (${NOW}, ${NOW}) RETURNING id`, [], c);
  await query(
    `INSERT INTO account_entries (account_id, entryable_type, entryable_id, amount, currency, date, name, excluded, created_at, updated_at)
     VALUES ($1, 'Account::Valuation', $2, $3, $4, $5, $6, false, ${NOW}, ${NOW})`,
    [accountId, v!.id, amount, currency, date, name],
    c,
  );
}

export { uuid };
