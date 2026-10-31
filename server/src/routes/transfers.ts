import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, one, query, tx } from "../db.js";
import { recomputeAccount } from "../balances.js";
import { HttpError, isoDate, parse, uuid } from "../util.js";
import { ownedAccount } from "./accounts.js";
import { deleteEntries } from "./entries.js";

/** A transfer is a pair of transactions (outflow +, inflow -) linked in `transfers`. They're excluded from budgets and income/expense totals. */
export async function transferRoutes(app: FastifyInstance) {
  app.post("/api/transfers", async (req) => {
    const b = parse(
      z.object({
        from_account_id: uuid,
        to_account_id: uuid,
        amount: z.number().positive(),
        to_amount: z.number().positive().optional(), // when currencies differ
        date: isoDate,
        notes: z.string().nullish(),
      }),
      req.body,
    );
    if (b.from_account_id === b.to_account_id) throw new HttpError(400, "Choose two different accounts");
    const from = await ownedAccount(req.user.familyId, b.from_account_id);
    const to = await ownedAccount(req.user.familyId, b.to_account_id);
    return tx(async (c) => {
      const mk = async (acct: any, amount: number, name: string) => {
        const t = await one<{ id: string }>(`INSERT INTO account_transactions (created_at, updated_at) VALUES (${NOW}, ${NOW}) RETURNING id`, [], c);
        await query(
          `INSERT INTO account_entries (account_id, entryable_type, entryable_id, amount, currency, date, name, notes, excluded, created_at, updated_at)
           VALUES ($1, 'Account::Transaction', $2, $3, $4, $5, $6, $7, false, ${NOW}, ${NOW})`,
          [acct.id, t!.id, amount, acct.currency, b.date, name, b.notes ?? null],
          c,
        );
        return t!.id;
      };
      const outflow = await mk(from, b.amount, `Transfer to ${to.name}`);
      const inflow = await mk(to, -(b.to_amount ?? b.amount), `Transfer from ${from.name}`);
      const tr = await one<{ id: string }>(
        `INSERT INTO transfers (inflow_transaction_id, outflow_transaction_id, status, notes, created_at, updated_at)
         VALUES ($1, $2, 'confirmed', $3, ${NOW}, ${NOW}) RETURNING id`,
        [inflow, outflow, b.notes ?? null],
        c,
      );
      await recomputeAccount(c, from.id);
      await recomputeAccount(c, to.id);
      return { id: tr!.id };
    });
  });

  // Auto-detected "pending" transfers can be confirmed...
  app.post("/api/transfers/:id/confirm", async (req) => {
    const tr = await ownedTransfer(req.user.familyId, (req.params as any).id);
    await query(`UPDATE transfers SET status = 'confirmed', updated_at = ${NOW} WHERE id = $1`, [tr.id]);
    return { ok: true };
  });

  // ...or rejected: the link is removed (entries stay as ordinary transactions) and remembered so it isn't re-suggested.
  app.post("/api/transfers/:id/unlink", async (req) => {
    const tr = await ownedTransfer(req.user.familyId, (req.params as any).id);
    await tx(async (c) => {
      await query("DELETE FROM transfers WHERE id = $1", [tr.id], c);
      await query(
        `INSERT INTO rejected_transfers (inflow_transaction_id, outflow_transaction_id, created_at, updated_at) VALUES ($1, $2, ${NOW}, ${NOW})`,
        [tr.inflow_transaction_id, tr.outflow_transaction_id],
        c,
      );
    });
    return { ok: true };
  });

  app.delete("/api/transfers/:id", async (req) => {
    const tr = await ownedTransfer(req.user.familyId, (req.params as any).id);
    await tx(async (c) => {
      const e = await query<{ id: string }>(
        "SELECT id FROM account_entries WHERE entryable_type = 'Account::Transaction' AND entryable_id IN ($1, $2)",
        [tr.inflow_transaction_id, tr.outflow_transaction_id],
        c,
      );
      await deleteEntries(c, req.user.familyId, e.map((x) => x.id));
    });
    return { ok: true };
  });
}

async function ownedTransfer(familyId: string, id: string) {
  const tr = await one<any>(
    `SELECT tr.* FROM transfers tr
     JOIN account_entries e ON e.entryable_id = tr.outflow_transaction_id AND e.entryable_type = 'Account::Transaction'
     JOIN accounts a ON a.id = e.account_id
     WHERE tr.id = $1 AND a.family_id = $2`,
    [id, familyId],
  );
  if (!tr) throw new HttpError(404, "Transfer not found");
  return tr;
}
