import type { Config } from "drizzle-kit";

// Only used for `drizzle-kit generate` (schema -> SQL migration files under
// ./drizzle). Applying migrations uses `drizzle-orm/libsql/migrator`, which
// works identically against a local SQLite file or a remote libSQL/Turso
// URL, so drizzle-kit itself never needs a live DB connection here. In
// production they are applied at build time by scripts/migrate.mjs (see
// vercel.ts); in development and tests, at first request via src/db/client.ts's
// `migrateDb`.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
