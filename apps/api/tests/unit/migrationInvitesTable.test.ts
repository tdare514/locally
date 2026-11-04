import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { assertMigrated, createDb, migrateDb } from "../../src/db/client";

const MIGRATION_TAG = "0014_small_wildside";
const drizzleDir = path.join(process.cwd(), "drizzle");

interface Journal {
  entries: Array<{ tag: string }>;
}

describe(`migration ${MIGRATION_TAG} (invites table, #186)`, () => {
  let previousDir: string;

  /** The migrations folder as the previous deployment shipped it: everything before this migration. */
  beforeEach(() => {
    previousDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-invites-"));
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

  it("applies over a populated database, keeps users and devices, and adds an empty invites table", async () => {
    const db = createDb(":memory:");
    await migrate(db, { migrationsFolder: previousDir });
    await db.run(sql`insert into users (id, email, created_at, storage_limit_bytes) values ('u-old', 'old@example.com', 1, 100)`);
    await db.run(sql`insert into devices (id, user_id, name, platform, token_hash, created_at, last_seen_at) values ('d-old', 'u-old', 'Mac', 'mac', 'h', 1, 1)`);
    await expect(db.all(sql`select * from invites`)).rejects.toThrow();

    await migrateDb(db);

    expect(await db.all(sql`select id from users`)).toEqual([{ id: "u-old" }]);
    expect(await db.all(sql`select id from devices`)).toEqual([{ id: "d-old" }]);
    expect(await db.all(sql`select * from invites`)).toEqual([]);
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });

  it("only adds: the table has the planned columns, and the previous code's statements still run", async () => {
    const db = createDb(":memory:");
    await migrateDb(db);

    const columns = await db.all<{ name: string; type: string; notnull: number; pk: number }>(
      sql`select name, type, "notnull", pk from pragma_table_info('invites') order by cid`
    );
    expect(columns).toEqual([
      { name: "email", type: "TEXT", notnull: 1, pk: 1 },
      { name: "invited_by", type: "TEXT", notnull: 1, pk: 0 },
      { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "used_at", type: "INTEGER", notnull: 0, pk: 0 },
    ]);

    await db.run(sql`insert into users (id, email, created_at, storage_limit_bytes) values ('u-new', 'new@example.com', 2, 100)`);
    await db.run(sql`insert into devices (id, user_id, name, platform, token_hash, created_at, last_seen_at) values ('d-new', 'u-new', 'iPhone', 'ios', 'h2', 2, 2)`);
    await db.run(sql`delete from users where id = 'u-new'`);
  });
});
