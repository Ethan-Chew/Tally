/**
 * Currency conversion helpers (SQL fragments).
 *
 * Mirrors how the original app resolved rates: use the nearest rate on/before the
 * date, else the nearest after it, else 1. Also falls back to the inverse of a
 * reverse-direction rate.
 */
export function fxJoin(alias: string, currencyExpr: string, dateExpr: string, familyCurrencyParam: string): string {
  return `LEFT JOIN LATERAL (
    SELECT x.rate FROM (
      SELECT rate, date FROM exchange_rates WHERE from_currency = ${currencyExpr} AND to_currency = ${familyCurrencyParam}
      UNION ALL
      SELECT 1 / NULLIF(rate, 0), date FROM exchange_rates WHERE to_currency = ${currencyExpr} AND from_currency = ${familyCurrencyParam}
    ) x
    ORDER BY (x.date <= ${dateExpr}) DESC, abs(x.date - ${dateExpr}) ASC
    LIMIT 1
  ) ${alias} ON ${currencyExpr} <> ${familyCurrencyParam}`;
}

export const fxRate = (alias: string) => `COALESCE(${alias}.rate, 1)`;
