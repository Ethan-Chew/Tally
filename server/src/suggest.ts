import { query } from "./db.js";
import { normaliseName } from "./recurring.js";

/** What past transactions say a description should be filed under: normalised name -> category id. Nothing is stored. */
export type Learned = Map<string, string>;

const MIN_USES = 2; // seen at least this often...
const MIN_SHARE = 0.6; // ...and at least this share of those were put in the same category

export async function learnCategories(familyId: string): Promise<Learned> {
  const rows = await query<{ name: string; merchant: string | null; category_id: string; n: number }>(
    `SELECT e.name, m.name AS merchant, t.category_id, count(*)::int AS n
     FROM account_entries e
     JOIN accounts a ON a.id = e.account_id AND a.family_id = $1
     JOIN account_transactions t ON e.entryable_type = 'Account::Transaction' AND t.id = e.entryable_id AND t.category_id IS NOT NULL
     LEFT JOIN merchants m ON m.id = t.merchant_id
     GROUP BY e.name, m.name, t.category_id`,
    [familyId],
  );
  // a transaction teaches both its own description and its merchant's name
  const votes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const label of new Set([r.name, r.merchant ?? ""])) {
      const k = normaliseName(label);
      if (!k) continue;
      const v = votes.get(k) ?? new Map<string, number>();
      v.set(r.category_id, (v.get(r.category_id) ?? 0) + r.n);
      votes.set(k, v);
    }
  }
  const learned: Learned = new Map();
  for (const [k, v] of votes) {
    const total = [...v.values()].reduce((s, n) => s + n, 0);
    const [cat, n] = [...v].sort((a, b) => b[1] - a[1])[0]!;
    if (total >= MIN_USES && n / total >= MIN_SHARE) learned.set(k, cat);
  }
  return learned;
}

export const suggestCategory = (learned: Learned, ...labels: (string | null | undefined)[]): string | null => {
  for (const l of labels) {
    const id = l ? learned.get(normaliseName(l)) : undefined;
    if (id) return id;
  }
  return null;
};
