import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { learnCategories, suggestCategory } from "../suggest.js";
import { parse } from "../util.js";

export async function suggestRoutes(app: FastifyInstance) {
  /** The category past transactions with the same description or merchant were filed under, if there is a clear answer. */
  app.get("/api/suggest-category", async (req) => {
    const q = parse(z.object({ name: z.string().default(""), merchant: z.string().optional() }), req.query);
    const learned = await learnCategories(req.user.familyId);
    return { category_id: suggestCategory(learned, q.merchant, q.name) };
  });
}
