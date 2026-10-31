import type { FastifyInstance } from "fastify";
import { one } from "./db.js";
import { HttpError } from "./util.js";

/**
 * There are no user accounts: this is a single-person app. Every request acts as the
 * first user (and their family) found in the database, so existing data just works.
 * The server binds to localhost by default; don't expose it to a network you don't trust.
 */
export interface Owner {
  id: string;
  familyId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  currency: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: Owner;
  }
}

export function registerOwner(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (!req.url.startsWith("/api/") || req.url === "/api/health") return;
    const u = await one<any>(
      `SELECT u.id, u.family_id, u.email, u.first_name, u.last_name, f.currency
       FROM users u JOIN families f ON f.id = u.family_id
       ORDER BY u.created_at LIMIT 1`,
    );
    if (!u) throw new HttpError(500, "No user/family found in the database. Restore your Maybe dump first.");
    req.user = { id: u.id, familyId: u.family_id, email: u.email, firstName: u.first_name, lastName: u.last_name, currency: u.currency ?? "USD" };
  });
}
