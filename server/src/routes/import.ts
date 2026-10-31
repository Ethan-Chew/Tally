import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, query, tx } from "../db.js";
import { recomputeAccount } from "../balances.js";
import { guessMapping, inferDateFormat, parseAmount, parseCsv, parseDate } from "../csv.js";
import { HttpError, parse, uuid } from "../util.js";
import { ownedAccount } from "./accounts.js";

const mappingSchema = z.object({
  date: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
});

const body = z.object({
  csv: z.string().min(1, "The file is empty"),
  account_id: uuid.optional(),
  mapping: mappingSchema.optional(),
  date_format: z.enum(["auto", "ymd", "dmy", "mdy"]).default("auto"),
  // Banks usually export spending as negative numbers. The app stores spending as positive.
  expense_sign: z.enum(["positive", "negative"]).default("negative"),
  skip_duplicates: z.boolean().default(true),
  create_categories: z.boolean().default(false),
  commit: z.boolean().default(false),
});

const key = (date: string, amount: number, name: string) => `${date}|${amount.toFixed(4)}|${name.trim().toLowerCase()}`;

export async function importRoutes(app: FastifyInstance) {
  app.post("/api/import", { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const b = parse(body, req.body);
    const { delimiter, rows } = parseCsv(b.csv);
    if (rows.length < 2) throw new HttpError(400, "Need a header row and at least one data row");
    const headers = rows[0]!.map((h) => h.trim());
    const data = rows.slice(1);

    // Step 1: no mapping yet, so describe the file
    if (!b.mapping) {
      return { delimiter, headers, row_count: data.length, sample: data.slice(0, 5), suggested_mapping: guessMapping(headers) };
    }

    const m = b.mapping;
    if (!m.amount && !m.debit && !m.credit) throw new HttpError(400, "Map an Amount column, or Debit/Credit columns");
    for (const col of Object.values(m)) if (col && !headers.includes(col)) throw new HttpError(400, `Column "${col}" isn't in the file`);
    if (!b.account_id) throw new HttpError(400, "Choose an account");
    const acct = await ownedAccount(req.user.familyId, b.account_id);
    const idx = (c?: string) => (c ? headers.indexOf(c) : -1);
    const iDate = idx(m.date), iName = idx(m.name), iAmt = idx(m.amount), iDeb = idx(m.debit), iCred = idx(m.credit), iCat = idx(m.category), iNotes = idx(m.notes);

    const cats = await query<{ id: string; name: string }>("SELECT id, name FROM categories WHERE family_id = $1", [req.user.familyId]);
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const dateFormat = b.date_format === "auto" ? inferDateFormat(data.map((r) => r[iDate] ?? "")) : b.date_format;

    interface Parsed { line: number; date: string; name: string; amount: number; category: string; notes: string }
    const parsed: Parsed[] = [];
    const errors: { line: number; message: string }[] = [];
    data.forEach((r, i) => {
      const line = i + 2;
      const cell = (n: number) => (n >= 0 ? (r[n] ?? "").trim() : "");
      const date = parseDate(cell(iDate), dateFormat);
      if (!date) return errors.push({ line, message: `Unrecognised date "${cell(iDate)}"${dateFormat === "auto" && /^\d+[-/.]\d+[-/.]\d+$/.test(cell(iDate)) ? " (pick a date format)" : ""}` });
      const name = cell(iName);
      if (!name) return errors.push({ line, message: "Missing description" });

      // Normalise to "positive = outflow" (the database convention)
      let amount: number;
      if (iAmt >= 0) {
        const a = parseAmount(cell(iAmt));
        if (Number.isNaN(a)) return errors.push({ line, message: `Unreadable amount "${cell(iAmt)}"` });
        amount = b.expense_sign === "negative" ? -a : a;
      } else {
        const d = parseAmount(cell(iDeb)), c = parseAmount(cell(iCred));
        amount = (Number.isNaN(d) ? 0 : Math.abs(d)) - (Number.isNaN(c) ? 0 : Math.abs(c));
      }
      if (amount === 0) return errors.push({ line, message: "Amount is zero" });
      parsed.push({ line, date, name, amount: Math.round(amount * 10000) / 10000, category: cell(iCat), notes: cell(iNotes) });
    });

    // Duplicates: match against what's already in the account (with multiplicity, so genuine repeats in the file survive)
    let toImport = parsed;
    let duplicates = 0;
    if (b.skip_duplicates && parsed.length) {
      const dates = parsed.map((p) => p.date).sort();
      const existing = await query<{ date: string; amount: number; name: string }>(
        `SELECT date::text, amount, name FROM account_entries
         WHERE account_id = $1 AND entryable_type = 'Account::Transaction' AND date BETWEEN $2 AND $3`,
        [acct.id, dates[0], dates[dates.length - 1]],
      );
      const seen = new Map<string, number>();
      for (const e of existing) seen.set(key(e.date, e.amount, e.name), (seen.get(key(e.date, e.amount, e.name)) ?? 0) + 1);
      toImport = parsed.filter((p) => {
        const k = key(p.date, p.amount, p.name);
        const n = seen.get(k) ?? 0;
        if (n > 0) { seen.set(k, n - 1); duplicates++; return false; }
        return true;
      });
    }

    const unknownCats = [...new Set(toImport.map((p) => p.category).filter((c) => c && !catByName.has(c.toLowerCase())))];
    const summary = {
      account: acct.name, currency: acct.currency, date_format_used: dateFormat, total_rows: data.length, valid: parsed.length, to_import: toImport.length,
      duplicates, errors: errors.slice(0, 50), error_count: errors.length, unknown_categories: unknownCats,
      preview: toImport.slice(0, 8).map((p) => ({ date: p.date, name: p.name, amount: p.amount, category: p.category })),
      income: toImport.filter((p) => p.amount < 0).reduce((s, p) => s - p.amount, 0),
      expense: toImport.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0),
    };
    if (!b.commit) return { ...summary, imported: 0 };
    if (!toImport.length) throw new HttpError(400, "Nothing to import");

    await tx(async (c) => {
      if (b.create_categories) {
        for (const name of unknownCats) {
          const first = toImport.find((p) => p.category === name)!;
          const created = await query<{ id: string }>(
            `INSERT INTO categories (family_id, name, color, classification, lucide_icon, created_at, updated_at)
             VALUES ($1, $2, '#737373', $3, 'shapes', ${NOW}, ${NOW}) RETURNING id`,
            [req.user.familyId, name, first.amount > 0 ? "expense" : "income"],
            c,
          );
          catByName.set(name.toLowerCase(), created[0]!.id);
        }
      }
      // ids are generated here so both tables can be bulk-inserted in one statement each
      const ids = toImport.map(() => randomUUID());
      await query(
        `INSERT INTO account_transactions (id, category_id, created_at, updated_at)
         SELECT i, cat, ${NOW}, ${NOW} FROM unnest($1::uuid[], $2::uuid[]) AS t(i, cat)`,
        [ids, toImport.map((p) => catByName.get(p.category.toLowerCase()) ?? null)],
        c,
      );
      await query(
        `INSERT INTO account_entries (account_id, entryable_type, entryable_id, amount, currency, date, name, notes, excluded, created_at, updated_at)
         SELECT $1, 'Account::Transaction', t.i, t.a, $2, t.d, t.n, NULLIF(t.o, ''), false, ${NOW}, ${NOW}
         FROM unnest($3::uuid[], $4::numeric[], $5::date[], $6::text[], $7::text[]) AS t(i, a, d, n, o)`,
        [acct.id, acct.currency, ids, toImport.map((p) => p.amount), toImport.map((p) => p.date), toImport.map((p) => p.name), toImport.map((p) => p.notes)],
        c,
      );
      await recomputeAccount(c, acct.id);
    });
    return { ...summary, imported: toImport.length };
  });
}
