import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { ReleaseSyncService } from "../../src/server/releases/ReleaseSyncService";
import { ConflictError, NotFoundError } from "../../src/shared/errors";
import { makeReleaseRecord } from "../support/fixtures";

describe("ReleaseSyncService", () => {
  let db: Db;
  let service: ReleaseSyncService;
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateDb(db);
    service = new ReleaseSyncService(db);
  });

  it("creates a release at version 1", async () => {
    const record = makeReleaseRecord();
    const result = await service.upsert(userA, record.id, record);
    expect(result.version).toBe(1);

    const stored = await service.getOwned(userA, record.id);
    expect(stored.title).toBe(record.title);
    expect(stored.version).toBe(1);
  });

  it("bumps the version on every write, monotonically per user across releases", async () => {
    const first = makeReleaseRecord();
    const second = makeReleaseRecord();
    expect((await service.upsert(userA, first.id, first)).version).toBe(1);
    expect((await service.upsert(userA, second.id, second)).version).toBe(2);

    const updated = { ...first, title: "New Title", updatedAt: new Date(Date.now() + 1000).toISOString() };
    expect((await service.upsert(userA, first.id, updated)).version).toBe(3);
  });

  it("rejects an update whose updatedAt is older than what's stored (409)", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    const older = { ...record, updatedAt: new Date(Date.parse(record.updatedAt) - 1000).toISOString() };
    await expect(service.upsert(userA, record.id, older)).rejects.toThrow(ConflictError);
  });

  it("accepts a retry with the same updatedAt and bumps the version (idempotent re-push)", async () => {
    // A client whose PUT landed but whose file uploads then failed re-sends
    // the identical record to finish the push; that must not be a 409.
    const record = makeReleaseRecord();
    const first = await service.upsert(userA, record.id, record);
    const retry = await service.upsert(userA, record.id, record);
    expect(retry.version).toBeGreaterThan(first.version);
    expect((await service.getOwned(userA, record.id)).version).toBe(retry.version);
  });

  it("accepts an update with a strictly newer updatedAt", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    const newer = { ...record, title: "Retitled", updatedAt: new Date(Date.parse(record.updatedAt) + 1000).toISOString() };
    const result = await service.upsert(userA, record.id, newer);
    expect(result.version).toBe(2);

    const stored = await service.getOwned(userA, record.id);
    expect(stored.title).toBe("Retitled");
  });

  it("404s when a release id belongs to another user (never reveals ownership)", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    await expect(service.getOwned(userB, record.id)).rejects.toThrow(NotFoundError);

    const attempt = { ...record, title: "Hijacked" };
    await expect(service.upsert(userB, record.id, attempt)).rejects.toThrow(NotFoundError);
  });

  it("tombstones a release: marks it deleted and bumps the version", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    const result = await service.tombstone(userA, record.id);
    expect(result.version).toBe(2);

    const stored = await service.getOwned(userA, record.id);
    expect(stored.deleted).toBe(true);
  });

  it("404s tombstoning a release owned by someone else, or that doesn't exist", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    await expect(service.tombstone(userB, record.id)).rejects.toThrow(NotFoundError);
    await expect(service.tombstone(userA, "33333333-3333-3333-3333-333333333333")).rejects.toThrow(NotFoundError);
  });

  it("listSince returns releases (and tombstones) newer than sinceVersion, plus nextVersion", async () => {
    const first = makeReleaseRecord();
    const second = makeReleaseRecord();
    await service.upsert(userA, first.id, first); // v1
    await service.upsert(userA, second.id, second); // v2
    await service.tombstone(userA, first.id); // v3

    const all = await service.listSince(userA, 0);
    expect(all.releases).toHaveLength(2);
    expect(all.nextVersion).toBe(3);

    const sinceV1 = await service.listSince(userA, 1);
    expect(sinceV1.releases.map((r) => r.version).sort()).toEqual([2, 3]);

    const tombstoned = sinceV1.releases.find((r) => r.id === first.id);
    expect(tombstoned?.deleted).toBe(true);
  });

  it("scopes listSince to the requesting user", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    const forB = await service.listSince(userB, 0);
    expect(forB.releases).toHaveLength(0);
    expect(forB.nextVersion).toBe(0);
  });

  it("gives concurrent writes for one user unique, increasing versions and loses none (#28)", async () => {
    const records = Array.from({ length: 20 }, () => makeReleaseRecord());
    const created = await Promise.all(records.map((r) => service.upsert(userA, r.id, r)));

    const edits = records.slice(0, 10).map((r) => ({ ...r, title: "Edited", updatedAt: new Date(Date.parse(r.updatedAt) + 1000).toISOString() }));
    const updated = await Promise.all([
      ...edits.map((r) => service.upsert(userA, r.id, r)),
      ...records.slice(10, 15).map((r) => service.tombstone(userA, r.id)),
    ]);

    const versions = [...created, ...updated].map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));

    const all = await service.listSince(userA, 0);
    expect(all.releases).toHaveLength(20);
    const listed = all.releases.map((r) => r.version);
    expect(listed).toEqual([...listed].sort((a, b) => a - b));
    expect(new Set(listed).size).toBe(listed.length);
    expect(all.nextVersion).toBe(35);
    expect(all.releases.filter((r) => r.title === "Edited")).toHaveLength(10);
    expect(all.releases.filter((r) => r.deleted)).toHaveLength(5);
  });

  it("keeps only the newest of concurrent writes to the same release", async () => {
    const record = makeReleaseRecord();
    await service.upsert(userA, record.id, record);

    const base = Date.parse(record.updatedAt);
    const writes = Array.from({ length: 5 }, (_, i) => ({ ...record, title: `T${i + 1}`, updatedAt: new Date(base + (i + 1) * 1000).toISOString() }));
    await Promise.allSettled(writes.map((w) => service.upsert(userA, w.id, w)));

    const stored = await service.getOwned(userA, record.id);
    expect(stored.title).toBe("T5");
  });
});
