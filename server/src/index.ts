import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { registerOwner } from "./owner.js";
import { HttpError } from "./util.js";
import { accountRoutes } from "./routes/accounts.js";
import { entryRoutes } from "./routes/entries.js";
import { transferRoutes } from "./routes/transfers.js";
import { taxonomyRoutes } from "./routes/taxonomy.js";
import { budgetRoutes } from "./routes/budgets.js";
import { calendarRoutes } from "./routes/calendar.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { meRoutes } from "./routes/me.js";
import { importRoutes } from "./routes/import.js";
import { systemRoutes } from "./routes/system.js";
import { recurringRoutes } from "./routes/recurring.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(compress, { threshold: 1024 });

// Accept an empty body with a JSON content-type (e.g. DELETE / action POSTs) instead of rejecting it.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  if (!body) return done(null, undefined);
  try {
    done(null, JSON.parse(body as string));
  } catch {
    done(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }), undefined);
  }
});

app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof ZodError) return reply.status(400).send({ error: err.issues[0]?.message ?? "Invalid request" });
  if (err?.code === "23505") return reply.status(409).send({ error: "That already exists" });
  if (err?.code === "23503") return reply.status(409).send({ error: "That record is still in use" });
  if (err?.validation || (err?.statusCode && err.statusCode < 500)) return reply.status(err.statusCode ?? 400).send({ error: err.message });
  app.log.error(err);
  return reply.status(500).send({ error: "Something went wrong" });
});

registerOwner(app);
app.get("/api/health", async () => ({ ok: true }));
for (const r of [accountRoutes, entryRoutes, transferRoutes, taxonomyRoutes, budgetRoutes, dashboardRoutes, calendarRoutes, meRoutes, importRoutes, systemRoutes, recurringRoutes]) await app.register(r);

// In production, serve the built SPA
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  // Vite emits content-hashed filenames under /assets, so they can be cached forever; index.html must always be revalidated.
  await app.register(fastifyStatic, {
    root: webDist,
    cacheControl: false, // we set Cache-Control ourselves below
    setHeaders: (res, path) => {
      res.setHeader("Cache-Control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html"),
  );
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
