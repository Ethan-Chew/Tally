import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { one } from "../db.js";
import { HttpError } from "../util.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const expand = (p: string) => p.replace(/^~(?=$|\/)/, homedir());
const backupDir = () => expand(process.env.BACKUP_DIR || join(homedir(), "Documents", "maybe-lite-backups"));

function listBackups(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^maybe_.*\.dump$/.test(f))
    .map((f) => { const s = statSync(join(dir, f)); return { name: f, size: s.size, modified: s.mtime.toISOString() }; })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Where the data lives, and one-click backups. Never exposes the password. */
export async function systemRoutes(app: FastifyInstance) {
  app.get("/api/system", async () => {
    let host = "unknown", port = "", name = "", user = "";
    try {
      const u = new URL(process.env.DATABASE_URL ?? "");
      host = u.hostname; port = u.port || "5432"; name = u.pathname.replace(/^\//, ""); user = decodeURIComponent(u.username);
    } catch { /* leave as unknown */ }
    const info = await one<any>(
      `SELECT pg_database_size(current_database())::bigint AS size, current_setting('server_version') AS version,
              (SELECT count(*) FROM accounts)::int AS accounts, (SELECT count(*) FROM account_transactions)::int AS transactions,
              (SELECT count(*) FROM account_entries)::int AS entries`,
    );
    const dir = backupDir();
    const backups = listBackups(dir);
    return {
      database: { host, port, name, user, local: ["localhost", "127.0.0.1", "::1"].includes(host), size: info.size, version: info.version },
      counts: { accounts: info.accounts, transactions: info.transactions, entries: info.entries },
      backups: { dir, mirror: process.env.BACKUP_MIRROR_DIR ? expand(process.env.BACKUP_MIRROR_DIR) : null, keep: Number(process.env.BACKUP_KEEP ?? 14), count: backups.length, latest: backups.slice(0, 5) },
    };
  });

  app.post("/api/system/backup", async () => {
    const script = join(root, "scripts/db/backup.sh");
    if (!existsSync(script)) throw new HttpError(500, "Backup script not found");
    const out = await new Promise<string>((res, rej) =>
      execFile("bash", [script], { env: process.env, timeout: 120_000 }, (err, stdout, stderr) =>
        err ? rej(new HttpError(500, (stderr || err.message).toString().split("\n").filter(Boolean).pop() ?? "Backup failed")) : res(stdout)),
    );
    const file = out.split("\n").find((l) => l.startsWith("BACKUP_FILE="))?.slice("BACKUP_FILE=".length);
    return { file, backups: listBackups(backupDir()).slice(0, 5) };
  });
}
