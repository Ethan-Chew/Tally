import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, one, query } from "../db.js";
import { parse } from "../util.js";

export async function meRoutes(app: FastifyInstance) {
  app.get("/api/me", async (req) => {
    const u = await one<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.default_period, f.currency, f.name AS family_name, f.country
       FROM users u JOIN families f ON f.id = u.family_id WHERE u.id = $1`,
      [req.user.id],
    );
    return { user: u };
  });

  app.patch("/api/me", async (req) => {
    const b = parse(
      z.object({
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        default_period: z.string().optional(),
        currency: z.string().length(3).optional(),
        family_name: z.string().nullish(),
      }),
      req.body,
    );
    await query(
      `UPDATE users SET first_name = CASE WHEN $2 THEN $3 ELSE first_name END, last_name = CASE WHEN $4 THEN $5 ELSE last_name END,
              default_period = COALESCE($6, default_period), updated_at = ${NOW} WHERE id = $1`,
      [req.user.id, "first_name" in b, b.first_name ?? null, "last_name" in b, b.last_name ?? null, b.default_period ?? null],
    );
    if (b.currency || "family_name" in b) {
      await query(
        `UPDATE families SET currency = COALESCE($2, currency), name = CASE WHEN $3 THEN $4 ELSE name END, updated_at = ${NOW} WHERE id = $1`,
        [req.user.familyId, b.currency?.toUpperCase() ?? null, "family_name" in b, b.family_name ?? null],
      );
    }
    return { ok: true };
  });
}
