import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { assertMigrated, createDb, migrateDb } from "../../src/db/client";

describe("assertMigrated", () => {
  it("passes after migrateDb", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });

  it("throws on a database that was never migrated", async () => {
    const db = createDb(":memory:");
    await expect(assertMigrated(db)).rejects.toThrow(/schema is behind/);
  });

  it("throws when the last migration is missing", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    await db.run(sql`delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)`);
    await expect(assertMigrated(db)).rejects.toThrow(/schema is behind/);
  });

  it("surfaces a query failure as itself, not as a schema mismatch", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    // Force a real query error that is not "no such table".
    await db.run(sql`drop table __drizzle_migrations`);
    await db.run(sql`create table __drizzle_migrations (id integer primary key)`);
    const err = await assertMigrated(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Failed query/);
    expect((err as Error).message).not.toMatch(/schema is behind/);
  });

  it("passes when the database is ahead of the code (rollback)", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);
    await db.run(
      sql`insert into __drizzle_migrations (hash, created_at) values ('newer', (select max(created_at) + 1000 from __drizzle_migrations))`
    );
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });
});
