import type { Config } from "drizzle-kit";

// Only used for `drizzle-kit generate` (schema -> SQL migration files under
// ./drizzle). Applying migrations happens at runtime via
// `drizzle-orm/libsql/migrator` (see src/db/client.ts's `migrateDb`), which
// works identically against a local SQLite file or a remote libSQL/Turso
// URL, so drizzle-kit itself never needs a live DB connection here.
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
