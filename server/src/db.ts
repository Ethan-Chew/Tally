import pg from "pg";

// numeric -> number, bigint -> number, date -> 'YYYY-MM-DD', timestamp (UTC, no tz) -> ISO string
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T") + "Z");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://localhost/maybe_production",
});

// An idle client being dropped (DB restart, failover) must not take the process down; the pool reconnects on next use.
pool.on("error", (err) => console.error("idle postgres client error:", err.message));

export type Db =pg.Pool | pg.PoolClient;

export async function query<T = Record<string, any>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const res = await db.query(sql, params as any[]);
  return res.rows as T[];
}

export async function one<T = Record<string, any>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, db))[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Rails stores timestamps as UTC without a time zone. */
export const NOW = "(now() AT TIME ZONE 'utc')";
