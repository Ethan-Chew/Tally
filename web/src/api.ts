export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ---- response types
export interface Account {
  id: string; name: string; accountable_type: string; subtype: string | null; classification: "asset" | "liability";
  balance: number; currency: string; is_active: boolean; balance_converted: number; balance_30d_ago: number | null;
}
export interface AccountsResponse { currency: string; assets: number; liabilities: number; net_worth: number; accounts: Account[] }
export interface Tag { id: string; name: string; color: string }
export interface Entry {
  id: string; entryable_type: string; entryable_id: string; account_id: string; account_name: string; date: string; name: string;
  amount: number; currency: string; amount_converted: number; notes: string | null; excluded: boolean;
  category_id: string | null; category_name: string | null; category_color: string | null; category_icon: string | null;
  merchant_id: string | null; merchant_name: string | null;
  transfer_id: string | null; transfer_status: "pending" | "confirmed" | null;
  qty: number | null; price: number | null; ticker: string | null; tags: Tag[];
}
export interface EntriesResponse { rows: Entry[]; total: number; income: number; expense: number; page: number; per_page: number; currency: string }
export interface Category { id: string; name: string; color: string; classification: "expense" | "income"; lucide_icon: string; parent_id: string | null; usage: number }
export interface Named { id: string; name: string; color: string; usage: number }
export interface BudgetCategory { category_id: string; name: string; color: string; lucide_icon: string; budgeted_spending: number; actual_spending: number }
export interface Budget {
  id: string; month: string; prev_month: string; next_month: string; currency: string; budgeted_spending: number; budgeted_spending_set: boolean;
  expected_income: number; allocated_spending: number; unallocated_spending: number; actual_spending: number; uncategorized_spending: number;
  actual_income: number; daily: { date: string; spent: number }[]; categories: BudgetCategory[];
}
export interface Dashboard {
  currency: string; period: string;
  net_worth: { current: number; change: number; assets: number; liabilities: number };
  series: { date: string; assets: number; liabilities: number; net_worth: number }[];
  by_type: { type: string; classification: string; total: number }[];
  cashflow: { income: number; expenses: number };
  spending_by_category: { category_id: string | null; name: string; color: string; icon: string | null; amount: number }[];
  recent: { id: string; date: string; name: string; amount: number; currency: string; account_name: string; category_name: string | null; category_color: string | null; category_icon: string | null; is_transfer: boolean }[];
}
export interface Me { id: string; email: string; first_name: string | null; last_name: string | null; default_period: string; currency: string; family_name: string | null }
