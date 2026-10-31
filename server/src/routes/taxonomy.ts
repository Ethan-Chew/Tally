import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOW, one, query, tx } from "../db.js";
import { HttpError, parse, uuid } from "../util.js";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Categories, merchants and tags: per-family labels that transactions point at. */
export async function taxonomyRoutes(app: FastifyInstance) {
  // ---- categories
  app.get("/api/categories", async (req) =>
    query(
      `SELECT c.id, c.name, c.color, c.classification, c.lucide_icon, c.parent_id,
              (SELECT count(*)::int FROM account_transactions t WHERE t.category_id = c.id) AS usage
       FROM categories c WHERE c.family_id = $1 ORDER BY c.classification DESC, c.name`,
      [req.user.familyId],
    ),
  );

  const categoryBody = z.object({
    name: z.string().trim().min(1),
    color,
    classification: z.enum(["expense", "income"]),
    lucide_icon: z.string().min(1).default("shapes"),
    parent_id: uuid.nullish(),
  });

  app.post("/api/categories", async (req) => {
    const b = parse(categoryBody, req.body);
    const r = await one<{ id: string }>(
      `INSERT INTO categories (family_id, name, color, classification, lucide_icon, parent_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${NOW}, ${NOW}) RETURNING id`,
      [req.user.familyId, b.name, b.color, b.classification, b.lucide_icon, b.parent_id ?? null],
    );
    return { id: r!.id };
  });

  app.patch("/api/categories/:id", async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(categoryBody.partial(), req.body);
    await query(
      `UPDATE categories SET name = COALESCE($3, name), color = COALESCE($4, color), classification = COALESCE($5, classification),
              lucide_icon = COALESCE($6, lucide_icon), updated_at = ${NOW} WHERE id = $1 AND family_id = $2`,
      [id, req.user.familyId, b.name ?? null, b.color ?? null, b.classification ?? null, b.lucide_icon ?? null],
    );
    return { ok: true };
  });

  app.delete("/api/categories/:id", async (req) => {
    const { id } = req.params as { id: string };
    await tx(async (c) => {
      // budget_categories has no ON DELETE rule; transactions are nulled by the FK
      await query("DELETE FROM budget_categories WHERE category_id = $1", [id], c);
      await query("UPDATE categories SET parent_id = NULL WHERE parent_id = $1", [id], c);
      await query("DELETE FROM categories WHERE id = $1 AND family_id = $2", [id, req.user.familyId], c);
    });
    return { ok: true };
  });

  // ---- merchants
  app.get("/api/merchants", async (req) =>
    query(
      `SELECT m.id, m.name, m.color, (SELECT count(*)::int FROM account_transactions t WHERE t.merchant_id = m.id) AS usage
       FROM merchants m WHERE m.family_id = $1 ORDER BY m.name`,
      [req.user.familyId],
    ),
  );
  app.post("/api/merchants", async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1), color: color.default("#e99537") }), req.body);
    const r = await one<{ id: string }>(
      `INSERT INTO merchants (family_id, name, color, created_at, updated_at) VALUES ($1, $2, $3, ${NOW}, ${NOW}) RETURNING id`,
      [req.user.familyId, b.name, b.color],
    );
    return { id: r!.id };
  });
  app.patch("/api/merchants/:id", async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).optional(), color: color.optional() }), req.body);
    await query(
      `UPDATE merchants SET name = COALESCE($3, name), color = COALESCE($4, color), updated_at = ${NOW} WHERE id = $1 AND family_id = $2`,
      [(req.params as any).id, req.user.familyId, b.name ?? null, b.color ?? null],
    );
    return { ok: true };
  });
  app.delete("/api/merchants/:id", async (req) => {
    const { id } = req.params as { id: string };
    await tx(async (c) => {
      await query("UPDATE account_transactions SET merchant_id = NULL WHERE merchant_id = $1", [id], c);
      await query("DELETE FROM merchants WHERE id = $1 AND family_id = $2", [id, req.user.familyId], c);
    });
    return { ok: true };
  });

  // ---- tags
  app.get("/api/tags", async (req) =>
    query(
      `SELECT g.id, g.name, g.color, (SELECT count(*)::int FROM taggings x WHERE x.tag_id = g.id) AS usage
       FROM tags g WHERE g.family_id = $1 ORDER BY g.name`,
      [req.user.familyId],
    ),
  );
  app.post("/api/tags", async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1), color: color.default("#6471eb") }), req.body);
    const r = await one<{ id: string }>(
      `INSERT INTO tags (family_id, name, color, created_at, updated_at) VALUES ($1, $2, $3, ${NOW}, ${NOW}) RETURNING id`,
      [req.user.familyId, b.name, b.color],
    );
    return { id: r!.id };
  });
  app.patch("/api/tags/:id", async (req) => {
    const b = parse(z.object({ name: z.string().trim().min(1).optional(), color: color.optional() }), req.body);
    await query(
      `UPDATE tags SET name = COALESCE($3, name), color = COALESCE($4, color), updated_at = ${NOW} WHERE id = $1 AND family_id = $2`,
      [(req.params as any).id, req.user.familyId, b.name ?? null, b.color ?? null],
    );
    return { ok: true };
  });
  app.delete("/api/tags/:id", async (req) => {
    const { id } = req.params as { id: string };
    const owned = await one("SELECT 1 FROM tags WHERE id = $1 AND family_id = $2", [id, req.user.familyId]);
    if (!owned) throw new HttpError(404, "Tag not found");
    await tx(async (c) => {
      await query("DELETE FROM taggings WHERE tag_id = $1", [id], c);
      await query("DELETE FROM tags WHERE id = $1", [id], c);
    });
    return { ok: true };
  });
}
