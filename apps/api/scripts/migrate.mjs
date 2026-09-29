// Applies the SQL migrations under drizzle/ to the configured database. Runs
// once per deploy, in the Vercel build (`buildCommand` in vercel.ts), and by
// hand as `npm run db:migrate`. See docs/plans/90-migrate-per-deploy.md.
//
// Plain ESM so it runs under `node` with no TypeScript loader. It spawns no
// processes and builds no shell strings.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

// Mirrors `databaseUrl` / `databaseAuthToken` in src/server/config/env.ts;
// the two must stay in step.
const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

if (!url) {
  if (process.env.VERCEL_ENV === "production") {
    console.error("migrate: no database configured for a production build (set TURSO_DATABASE_URL or DATABASE_URL)");
    process.exit(1);
  }
  console.log("migrate: no database configured, skipping");
  process.exit(0);
}

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function appliedCount(client) {
  try {
    const rs = await client.execute("select count(*) as n from __drizzle_migrations");
    return Number(rs.rows[0].n);
  } catch {
    // The table does not exist before the first migration.
    return 0;
  }
}

let client;
try {
  if (url.startsWith("file:")) {
    const dir = path.dirname(url.slice("file:".length));
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  client = createClient({ url, authToken });
  const before = await appliedCount(client);
  await migrate(drizzle(client), { migrationsFolder });
  const after = await appliedCount(client);
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
  const latest = journal.entries.at(-1)?.tag ?? "none";
  console.log(`migrate: applied ${after - before} migration(s), ${after} total, latest ${latest}`);
} catch (err) {
  console.error("migrate: failed:", err);
  process.exitCode = 1;
} finally {
  client?.close();
}
