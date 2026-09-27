import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Build a Drizzle client over libSQL. `url` defaults to `DATABASE_URL`, or a
 * local SQLite file so `npm run dev`/`npm run check` work with no env vars
 * set at all. Tests pass `:memory:` explicitly for full isolation.
 */
export function createDb(url: string = process.env.DATABASE_URL ?? "file:./data/dev.db"): Db {
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = path.dirname(filePath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const client = createClient({ url });
  return drizzle(client, { schema });
}

/** Apply every migration under `drizzle/`. Safe to call repeatedly (idempotent). */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
