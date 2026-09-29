import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Database client and migrations. In production, migrations are applied at
 * build time by `scripts/migrate.mjs` (run from the Vercel build, see
 * `vercel.ts`) and the server only calls `assertMigrated` on startup; in
 * development and tests, `migrateDb` applies them on first request.
 */

export type Db = LibSQLDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Build a Drizzle client over libSQL. `url` defaults to `DATABASE_URL`, or a
 * local SQLite file so `npm run dev`/`npm run check` work with no env vars
 * set at all. Tests pass `:memory:` explicitly for full isolation. `authToken`
 * is for a remote database whose token isn't embedded in the URL.
 */
export function createDb(url: string = process.env.DATABASE_URL ?? "file:./data/dev.db", authToken?: string): Db {
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = path.dirname(filePath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const client = createClient({ url, authToken });
  return drizzle(client, { schema });
}

/** Apply every migration under `drizzle/`. Safe to call repeatedly (idempotent). */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** The last entry of the migration journal: the tag and the `when` the migrator stores as `created_at`. */
function lastJournalEntry(): { tag: string; when: number } | undefined {
  const raw = fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as { entries: { tag: string; when: number }[] };
  return journal.entries.at(-1);
}

/** Drizzle wraps driver errors ("Failed query: …") with the SQLite message in `cause`, so walk the chain. */
function isMissingTable(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const message = e instanceof Error ? e.message : String(e);
    if (/no such table/i.test(message)) return true;
  }
  return false;
}

/**
 * Throw unless the database has at least the journal's last migration applied.
 * "At least" rather than "equal": after a rollback, older code runs against a
 * newer schema and must still start.
 */
export async function assertMigrated(db: Db): Promise<void> {
  const expected = lastJournalEntry();
  if (!expected) return;
  let latest: number | null = null;
  try {
    const rows = await db.all<{ latest: number | null }>(sql`select max(created_at) as latest from __drizzle_migrations`);
    latest = rows[0]?.latest == null ? null : Number(rows[0].latest);
  } catch (err) {
    // No __drizzle_migrations table means nothing has been applied; any other
    // failure (unreachable database, bad token) must surface as itself.
    if (!isMissingTable(err)) throw err;
  }
  if (latest === null || latest < expected.when) {
    throw new Error(
      `Database schema is behind: expected migration ${expected.tag} (${expected.when}) but the latest applied is ${latest ?? "none"}. ` +
        "Run npm run db:migrate (in production this happens in the Vercel build)."
    );
  }
}
