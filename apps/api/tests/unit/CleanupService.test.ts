import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { authCodes, files, pendingDeletes, rateLimits, releases, userCounters, users } from "../../src/db/schema";
import { CleanupService } from "../../src/server/cleanup/CleanupService";
import type { FileStore } from "../../src/server/files/FileStore";
import { makeReleaseRecord } from "../support/fixtures";

class RecordingFileStore implements FileStore {
  public deleted: string[] = [];
  /** Keys that throw on `delete` instead of succeeding, e.g. to test a failed drain attempt. */
  public failing = new Set<string>();
  async createUpload(): ReturnType<FileStore["createUpload"]> {
    throw new Error("not used in this test");
  }
  async createDownload(): ReturnType<FileStore["createDownload"]> {
    throw new Error("not used in this test");
  }
  async delete(key: string): Promise<void> {
    if (this.failing.has(key)) {
      throw new Error(`simulated failure deleting ${key}`);
    }
    this.deleted.push(key);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("CleanupService", () => {
  let db: Db;
  let fileStore: RecordingFileStore;
  let clock: number;
  const userId = crypto.randomUUID();

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateDb(db);
    fileStore = new RecordingFileStore();
    clock = Date.UTC(2026, 0, 31);
    await db.insert(users).values({ id: userId, email: "person@example.com", createdAt: clock });
  });

  async function insertRelease(deleted: boolean, serverUpdatedAt: number): Promise<string> {
    const record = makeReleaseRecord({ deleted });
    await db.insert(releases).values({
      id: record.id,
      userId,
      version: 1,
      record,
      updatedAt: Date.parse(record.updatedAt),
      deleted,
      serverUpdatedAt,
    });
    await db.insert(userCounters).values({ userId, version: 1 }).onConflictDoUpdate({
      target: userCounters.userId,
      set: { version: 1 },
    });
    return record.id;
  }

  it("deletes storage objects for tombstones older than 30 days, but not newer ones", async () => {
    const oldTombstoneId = await insertRelease(true, clock - 31 * DAY_MS);
    const recentTombstoneId = await insertRelease(true, clock - 1 * DAY_MS);
    const liveReleaseId = await insertRelease(false, clock - 60 * DAY_MS);

    await db.insert(files).values([
      {
        id: crypto.randomUUID(),
        releaseId: oldTombstoneId,
        userId,
        name: "01.mp3",
        bytes: 1,
        contentType: "audio/mpeg",
        storageKey: `users/${userId}/releases/${oldTombstoneId}/01.mp3`,
        createdAt: clock,
      },
      {
        id: crypto.randomUUID(),
        releaseId: recentTombstoneId,
        userId,
        name: "01.mp3",
        bytes: 1,
        contentType: "audio/mpeg",
        storageKey: `users/${userId}/releases/${recentTombstoneId}/01.mp3`,
        createdAt: clock,
      },
      {
        id: crypto.randomUUID(),
        releaseId: liveReleaseId,
        userId,
        name: "01.mp3",
        bytes: 1,
        contentType: "audio/mpeg",
        storageKey: `users/${userId}/releases/${liveReleaseId}/01.mp3`,
        createdAt: clock,
      },
    ]);

    const cleanup = new CleanupService(db, fileStore, () => clock);
    const result = await cleanup.run();

    expect(result.deletedFiles).toBe(1);
    expect(fileStore.deleted).toEqual([`users/${userId}/releases/${oldTombstoneId}/01.mp3`]);

    const remaining = await db.select().from(files);
    expect(remaining).toHaveLength(2);
    // Each remaining file is 1 byte, so the total reflects the post-deletion count.
    expect(result.totalStoredBytes).toBe(2);
  });

  it("returns 0 total stored bytes when the files table is empty", async () => {
    const cleanup = new CleanupService(db, fileStore, () => clock);
    const result = await cleanup.run();
    expect(result.totalStoredBytes).toBe(0);
  });

  it("deletes expired auth codes but keeps unexpired ones", async () => {
    await db.insert(authCodes).values([
      {
        id: crypto.randomUUID(),
        email: "a@example.com",
        codeHash: "x",
        createdAt: clock - DAY_MS,
        expiresAt: clock - 1000, // expired
        attempts: 0,
        consumedAt: null,
      },
      {
        id: crypto.randomUUID(),
        email: "b@example.com",
        codeHash: "y",
        createdAt: clock,
        expiresAt: clock + 10 * 60 * 1000, // still valid
        attempts: 0,
        consumedAt: null,
      },
    ]);

    const cleanup = new CleanupService(db, fileStore, () => clock);
    const result = await cleanup.run();

    expect(result.deletedAuthCodes).toBe(1);
    const remaining = await db.select().from(authCodes);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.email).toBe("b@example.com");
  });

  it("deletes rate limit windows older than 24h but keeps recent ones", async () => {
    await db.insert(rateLimits).values([
      { key: "code:email:stale@example.com", windowStart: clock - DAY_MS - 1000, count: 5 },
      { key: "code:email:fresh@example.com", windowStart: clock - 1000, count: 2 },
    ]);

    const cleanup = new CleanupService(db, fileStore, () => clock);
    const result = await cleanup.run();

    expect(result.deletedRateLimits).toBe(1);
    const remaining = await db.select().from(rateLimits);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.key).toBe("code:email:fresh@example.com");
  });

  describe("pending_deletes (account deletion's blob queue)", () => {
    const keyA1 = `users/${crypto.randomUUID()}/releases/r1/01.mp3`;
    const keyA2 = `users/${crypto.randomUUID()}/releases/r2/01.mp3`;
    const keyB1 = `users/${crypto.randomUUID()}/releases/r3/01.mp3`;

    it("run() drains every queued key oldest-first and empties the queue", async () => {
      await db.insert(pendingDeletes).values([
        { storageKey: keyA1, enqueuedAt: clock - 2000, attempts: 0 },
        { storageKey: keyA2, enqueuedAt: clock - 1000, attempts: 0 },
        { storageKey: keyB1, enqueuedAt: clock, attempts: 0 },
      ]);

      const cleanup = new CleanupService(db, fileStore, () => clock);
      const result = await cleanup.run();

      expect(result.drainedPendingDeletes).toBe(3);
      expect(fileStore.deleted).toEqual([keyA1, keyA2, keyB1]);
      expect(await db.select().from(pendingDeletes)).toHaveLength(0);
    });

    it("leaves only the failing key queued, with attempts bumped, and finishes it on the next run", async () => {
      fileStore.failing.add(keyA1);
      await db.insert(pendingDeletes).values([
        { storageKey: keyA1, enqueuedAt: clock - 1000, attempts: 0 },
        { storageKey: keyB1, enqueuedAt: clock, attempts: 0 },
      ]);

      const cleanup = new CleanupService(db, fileStore, () => clock);
      const firstRun = await cleanup.run();

      expect(firstRun.drainedPendingDeletes).toBe(1);
      expect(fileStore.deleted).toEqual([keyB1]);
      const stillQueued = await db.select().from(pendingDeletes);
      expect(stillQueued).toHaveLength(1);
      expect(stillQueued[0]?.storageKey).toBe(keyA1);
      expect(stillQueued[0]?.attempts).toBe(1);

      fileStore.failing.delete(keyA1);
      const secondRun = await cleanup.run();
      expect(secondRun.drainedPendingDeletes).toBe(1);
      expect(await db.select().from(pendingDeletes)).toHaveLength(0);
    });

    it("run() drains past one page, skipping a failing key at the head of the queue", async () => {
      const keys = Array.from({ length: 450 }, (_, i) => `users/u/releases/r/${String(i).padStart(3, "0")}.mp3`);
      fileStore.failing.add(keys[0]!);
      await db.insert(pendingDeletes).values(keys.map((storageKey, i) => ({ storageKey, enqueuedAt: clock + i, attempts: 0 })));

      const cleanup = new CleanupService(db, fileStore, () => clock);
      const result = await cleanup.run();

      expect(result.drainedPendingDeletes).toBe(449);
      const remaining = await db.select().from(pendingDeletes);
      expect(remaining.map((r) => r.storageKey)).toEqual([keys[0]]);
    });

    it("drainPendingDeletes drains only the given keys, leaving the rest of the queue for the cron", async () => {
      await db.insert(pendingDeletes).values([
        { storageKey: keyA1, enqueuedAt: clock, attempts: 0 },
        { storageKey: keyA2, enqueuedAt: clock, attempts: 0 },
        { storageKey: keyB1, enqueuedAt: clock, attempts: 0 },
      ]);

      const cleanup = new CleanupService(db, fileStore, () => clock);
      const drained = await cleanup.drainPendingDeletes([keyA1, keyA2]);

      expect(drained).toBe(2);
      expect(fileStore.deleted.sort()).toEqual([keyA1, keyA2].sort());
      const remaining = await db.select().from(pendingDeletes);
      expect(remaining.map((r) => r.storageKey)).toEqual([keyB1]);
    });
  });
});
