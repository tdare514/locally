import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { assertMigrated, createDb, migrateDb } from "../../src/db/client";

const MIGRATION_TAG = "0005_powerful_captain_midlands";
const drizzleDir = path.join(process.cwd(), "drizzle");

interface Journal {
  entries: Array<{ tag: string }>;
}

describe(`migration ${MIGRATION_TAG} (users.resync_requested_at, #119)`, () => {
  let previousDir: string;

  /** The migrations folder as the previous deployment shipped it: everything before this migration. */
  beforeEach(() => {
    previousDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-resync-"));
    fs.mkdirSync(path.join(previousDir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as Journal;
    const index = journal.entries.findIndex((entry) => entry.tag === MIGRATION_TAG);
    expect(index, "the migration is in the journal").toBeGreaterThan(0);
    const previous = journal.entries.slice(0, index);
    fs.writeFileSync(path.join(previousDir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: previous }));
    for (const entry of previous) fs.copyFileSync(path.join(drizzleDir, `${entry.tag}.sql`), path.join(previousDir, `${entry.tag}.sql`));
  });

  afterEach(() => {
    fs.rmSync(previousDir, { recursive: true, force: true });
  });

  it("applies over a populated database, keeps existing users, and leaves the new column null", async () => {
    const db = createDb(":memory:");
    await migrate(db, { migrationsFolder: previousDir });
    await db.run(sql`insert into users (id, email, created_at, storage_limit_bytes) values ('u-old', 'old@example.com', 1, 100)`);
    await expect(db.all(sql`select resync_requested_at from users`)).rejects.toThrow();

    await migrateDb(db);

    const rows = await db.all<{ id: string; storage_limit_bytes: number; resync_requested_at: number | null }>(
      sql`select id, storage_limit_bytes, resync_requested_at from users`
    );
    expect(rows).toEqual([{ id: "u-old", storage_limit_bytes: 100, resync_requested_at: null }]);
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });

  it("adds a nullable column with no default, so the previous deployment's inserts still work", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);

    const columns = await db.all<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
      sql`select name, type, "notnull", dflt_value from pragma_table_info('users') where name = 'resync_requested_at'`
    );
    expect(columns).toEqual([{ name: "resync_requested_at", type: "INTEGER", notnull: 0, dflt_value: null }]);

    // An insert written for the old column list, as an old instance still serving would run.
    await db.run(sql`insert into users (id, email, created_at, storage_limit_bytes) values ('u-new', 'new@example.com', 2, 100)`);
    const [row] = await db.all<{ resync_requested_at: number | null }>(sql`select resync_requested_at from users where id = 'u-new'`);
    expect(row?.resync_requested_at).toBeNull();
  });
});
