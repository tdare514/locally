import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { authCodes, files, pendingDeletes, playCounts, playDays, rateLimits, releases, userCounters, users } from "../../src/db/schema";
import { CleanupService } from "../../src/server/cleanup/CleanupService";
import type { FileStore } from "../../src/server/files/FileStore";
import { makeReleaseRecord } from "../support/fixtures";

class RecordingFileStore implements FileStore {
  public deleted: string[] = [];
  /** Keys that throw on `delete` / `deleteMany` instead of succeeding. */
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
    this.stored.delete(key);
  }
  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }
  /** Keys `listKeys` reports as stored. */
  public stored = new Set<string>();
  /** The prefix of every `listKeys` call, in order. */
  public listed: string[] = [];
  async *listKeys(prefix: string): AsyncGenerator<string> {
    this.listed.push(prefix);
    for (const key of [...this.stored]) {
      if (key.startsWith(prefix)) yield key;
    }
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

  it("cleans more old tombstone files than one page, and a second run finds nothing", async () => {
    const tombstoneIds = [
      await insertRelease(true, clock - 31 * DAY_MS),
      await insertRelease(true, clock - 45 * DAY_MS),
      await insertRelease(true, clock - 90 * DAY_MS),
    ];
    const liveReleaseId = await insertRelease(false, clock - 60 * DAY_MS);

    const tombstoneFiles = Array.from({ length: 450 }, (_, i) => {
      const releaseId = tombstoneIds[i % tombstoneIds.length]!;
      const name = `${String(i).padStart(3, "0")}.mp3`;
      return {
        id: crypto.randomUUID(),
        releaseId,
        userId,
        name,
        bytes: 1,
        contentType: "audio/mpeg",
        storageKey: `users/${userId}/releases/${releaseId}/${name}`,
        createdAt: clock,
      };
    });
    const liveKey = `users/${userId}/releases/${liveReleaseId}/01.mp3`;
    await db.insert(files).values([
      ...tombstoneFiles,
      {
        id: crypto.randomUUID(),
        releaseId: liveReleaseId,
        userId,
        name: "01.mp3",
        bytes: 1,
        contentType: "audio/mpeg",
        storageKey: liveKey,
        createdAt: clock,
      },
    ]);

    const cleanup = new CleanupService(db, fileStore, () => clock);
    const first = await cleanup.run();

    expect(first.deletedFiles).toBe(450);
    expect([...fileStore.deleted].sort()).toEqual(tombstoneFiles.map((f) => f.storageKey).sort());
    const afterFirst = await db.select().from(files);
    expect(afterFirst.map((f) => f.storageKey)).toEqual([liveKey]);
    const tombstoneRows = await db.select().from(releases);
    expect(tombstoneRows).toHaveLength(4);
    expect(tombstoneRows.filter((r) => r.deleted)).toHaveLength(3);

    fileStore.deleted = [];
    const second = await cleanup.run();

    expect(second.deletedFiles).toBe(0);
    expect(fileStore.deleted).toEqual([]);
    expect((await db.select().from(files)).map((f) => f.storageKey)).toEqual([liveKey]);
  });

  it("deletes play counts of tombstones older than 30 days, keeping newer tombstones and live releases", async () => {
    const oldTombstoneId = await insertRelease(true, clock - 31 * DAY_MS);
    const recentTombstoneId = await insertRelease(true, clock - 1 * DAY_MS);
    const liveReleaseId = await insertRelease(false, clock - 60 * DAY_MS);
    const deviceId = crypto.randomUUID();
    await db.insert(playCounts).values(
      [oldTombstoneId, recentTombstoneId, liveReleaseId].map((releaseId) => ({
        userId,
        deviceId,
        releaseId,
        trackId: crypto.randomUUID(),
        count: 3,
        updatedAt: clock,
      }))
    );

    const result = await new CleanupService(db, fileStore, () => clock).run();

    expect(result.deletedPlayCounts).toBe(1);
    const remaining = await db.select().from(playCounts);
    expect(remaining.map((r) => r.releaseId).sort()).toEqual([recentTombstoneId, liveReleaseId].sort());
  });

  it("deletes play days of old tombstones, and day buckets more than 400 days old, keeping the rest", async () => {
    const oldTombstoneId = await insertRelease(true, clock - 31 * DAY_MS);
    const liveReleaseId = await insertRelease(false, clock - 60 * DAY_MS);
    const deviceId = crypto.randomUUID();
    const row = (releaseId: string, day: string) => ({
      userId,
      deviceId,
      releaseId,
      trackId: crypto.randomUUID(),
      day,
      count: 1,
      updatedAt: clock,
    });
    // clock is 2026-01-31 UTC; 400 days before is 2024-12-27, so 2024-12-26 is expired.
    await db.insert(playDays).values([
      row(oldTombstoneId, "2026-01-30"),
      row(liveReleaseId, "2024-12-26"),
      row(liveReleaseId, "2024-12-27"),
      row(liveReleaseId, "2026-01-30"),
    ]);

    const result = await new CleanupService(db, fileStore, () => clock).run();

    expect(result.deletedPlayDays).toBe(1);
    expect(result.expiredPlayDays).toBe(1);
    const remaining = await db.select().from(playDays);
    expect(remaining.map((r) => r.day).sort()).toEqual(["2024-12-27", "2026-01-30"]);
  });

  it("deletes expired day buckets a page at a time and counts every page", async () => {
    const liveReleaseId = await insertRelease(false, clock - 60 * DAY_MS);
    const deviceId = crypto.randomUUID();
    // 450 expired rows (more than two pages of 200) and one kept.
    const rows = Array.from({ length: 451 }, (_, i) => ({
      userId,
      deviceId,
      releaseId: liveReleaseId,
      trackId: crypto.randomUUID(),
      day: i === 450 ? "2026-01-30" : "2024-12-26",
      count: 1,
      updatedAt: clock,
    }));
    for (let i = 0; i < rows.length; i += 100) await db.insert(playDays).values(rows.slice(i, i + 100));

    const result = await new CleanupService(db, fileStore, () => clock).run();

    expect(result.expiredPlayDays).toBe(450);
    expect((await db.select().from(playDays)).map((r) => r.day)).toEqual(["2026-01-30"]);
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

  it("deletes more expired auth codes than one page", async () => {
    const expired = Array.from({ length: 450 }, (_, i) => ({
      id: crypto.randomUUID(),
      email: `expired${i}@example.com`,
      codeHash: "x",
      createdAt: clock - DAY_MS,
      expiresAt: clock - 1000 - i,
      attempts: 0,
      consumedAt: null,
    }));
    const valid = ["keep1@example.com", "keep2@example.com"].map((email) => ({
      id: crypto.randomUUID(),
      email,
      codeHash: "y",
      createdAt: clock,
      expiresAt: clock + 10 * 60 * 1000,
      attempts: 0,
      consumedAt: null,
    }));
    await db.insert(authCodes).values([...expired, ...valid]);

    const cleanup = new CleanupService(db, fileStore, () => clock);
    const result = await cleanup.run();

    expect(result.deletedAuthCodes).toBe(450);
    const remaining = await db.select().from(authCodes);
    expect(remaining.map((r) => r.email).sort()).toEqual(["keep1@example.com", "keep2@example.com"]);
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

  describe("unfinished uploads and orphan objects (#89)", () => {
    const releaseId = crypto.randomUUID();
    const prefix = `users/${userId}/releases/`;
    /** One release per owner: (release, name) is unique in `files`. */
    const releaseOf = (owner: string) => (owner === userId ? releaseId : `release-of-${owner}`);
    const keyFor = (name: string, owner: string = userId) => `users/${owner}/releases/${releaseOf(owner)}/${name}`;

    async function insertFile(
      name: string,
      createdAt: number,
      opts: { owner?: string; bytes?: number; verifiedAt?: number | null } = {}
    ): Promise<string> {
      const owner = opts.owner ?? userId;
      const id = crypto.randomUUID();
      await db.insert(files).values({
        id,
        releaseId: releaseOf(owner),
        userId: owner,
        name,
        bytes: opts.bytes ?? 100,
        contentType: "audio/mpeg",
        storageKey: keyFor(name, owner),
        createdAt,
        verifiedAt: opts.verifiedAt ?? null,
      });
      return id;
    }

    async function rowNames(owner = userId): Promise<string[]> {
      const rows = await db.select({ name: files.name }).from(files).where(eq(files.userId, owner));
      return rows.map((r) => r.name).sort();
    }

    const run = () => new CleanupService(db, fileStore, () => clock).run();

    it("marks an old row whose object is stored as verified, and never deletes it later", async () => {
      const id = await insertFile("a.mp3", clock - 2 * DAY_MS);
      fileStore.stored.add(keyFor("a.mp3"));

      const first = await run();
      expect(first.verifiedFiles).toBe(1);
      const [row] = await db.select().from(files).where(eq(files.id, id));
      expect(row!.verifiedAt).toBe(clock);

      // The object vanishes later; a verified row is not looked at again.
      fileStore.stored.clear();
      clock += 10 * DAY_MS;
      const second = await run();
      expect(second.abandonedFiles).toBe(0);
      expect(await rowNames()).toEqual(["a.mp3"]);
    });

    it("deletes an old row with no object when the listing is complete, and frees its bytes", async () => {
      await insertFile("gone.mp3", clock - 2 * DAY_MS, { bytes: 700 });
      await insertFile("kept.mp3", clock - 2 * DAY_MS, { bytes: 300 });
      fileStore.stored.add(keyFor("kept.mp3"));

      const result = await run();

      expect(result.abandonedFiles).toBe(1);
      expect(await rowNames()).toEqual(["kept.mp3"]);
      expect(result.totalStoredBytes).toBe(300);
    });

    it("keeps an old row with no object when the listing was capped", async () => {
      await insertFile("a.mp3", clock - 2 * DAY_MS);
      for (let i = 0; i < 50_000; i++) fileStore.stored.add(`${prefix}other/${i}.mp3`);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await run();

      expect(result.abandonedFiles).toBe(0);
      expect(result.orphanObjects).toBe(0);
      expect(fileStore.deleted).toEqual([]);
      expect(await rowNames()).toEqual(["a.mp3"]);
      expect(warn.mock.calls.some(([line]) => String(line).includes("verify_uploads_truncated"))).toBe(true);
      warn.mockRestore();
    });

    it("leaves a row younger than 24 hours untouched", async () => {
      const id = await insertFile("new.mp3", clock - 23 * 60 * 60 * 1000);

      const result = await run();

      expect(result.verifiedFiles + result.abandonedFiles).toBe(0);
      expect(fileStore.listed).toEqual([]);
      const [row] = await db.select().from(files).where(eq(files.id, id));
      expect(row!.verifiedAt).toBeNull();
    });

    it("deletes an orphan object but not one with a row, one of a tombstoned release, or one queued for delete", async () => {
      await insertFile("old.mp3", clock - 2 * DAY_MS);
      await insertFile("tombstoned.mp3", clock - 2 * DAY_MS, { verifiedAt: clock - DAY_MS });
      fileStore.stored.add(keyFor("old.mp3"));
      fileStore.stored.add(keyFor("tombstoned.mp3"));
      fileStore.stored.add(keyFor("orphan.mp3"));
      fileStore.stored.add(keyFor("queued.mp3"));
      // A failing drain leaves the key queued while its object is still listed: the sweep must skip it.
      fileStore.failing.add(keyFor("queued.mp3"));
      await db.insert(pendingDeletes).values({ storageKey: keyFor("queued.mp3"), enqueuedAt: clock, attempts: 0 });

      const result = await run();

      expect(result.orphanObjects).toBe(1);
      expect(fileStore.deleted).toEqual([keyFor("orphan.mp3")]);
    });

    it("never sweeps with a prefix other than the user's own", async () => {
      await insertFile("old.mp3", clock - 2 * DAY_MS);
      fileStore.stored.add(keyFor("old.mp3"));
      await run();
      expect(fileStore.listed).toEqual([prefix]);
    });

    it("lists at most 50 users a run, oldest first, and the next run continues", async () => {
      const owners: string[] = [];
      for (let i = 0; i < 52; i++) {
        const owner = crypto.randomUUID();
        owners.push(owner);
        await db.insert(users).values({ id: owner, email: `u${i}@example.com`, createdAt: clock });
        // Older users first; none has its object, so a visited user's row is deleted.
        await insertFile("a.mp3", clock - 3 * DAY_MS + i, { owner });
      }

      const first = await run();
      expect(first.abandonedFiles).toBe(50);
      expect(fileStore.listed).toHaveLength(50);
      expect(new Set(fileStore.listed)).not.toContain(`users/${owners[50]}/releases/`);

      const second = await run();
      expect(second.abandonedFiles).toBe(2);
      expect(fileStore.listed).toHaveLength(52);
    });

    it("deletes at most 1,000 orphans per user a run, and the next run continues", async () => {
      await insertFile("old.mp3", clock - 2 * DAY_MS);
      fileStore.stored.add(keyFor("old.mp3"));
      for (let i = 0; i < 1500; i++) fileStore.stored.add(keyFor(`orphan-${i}.mp3`));

      const first = await run();
      expect(first.orphanObjects).toBe(1000);

      // The row verified in run one, so the user is not listed again: no further sweep (by design).
      await insertFile("second.mp3", clock - 2 * DAY_MS);
      fileStore.stored.add(keyFor("second.mp3"));
      const second = await run();
      expect(second.orphanObjects).toBe(500);
      expect(fileStore.stored.has(keyFor("old.mp3"))).toBe(true);
      expect(fileStore.stored.has(keyFor("second.mp3"))).toBe(true);
    });

    it("is idempotent: a second run on the same state changes nothing", async () => {
      await insertFile("ok.mp3", clock - 2 * DAY_MS);
      await insertFile("gone.mp3", clock - 2 * DAY_MS);
      fileStore.stored.add(keyFor("ok.mp3"));
      fileStore.stored.add(keyFor("orphan.mp3"));

      const first = await run();
      expect([first.verifiedFiles, first.abandonedFiles, first.orphanObjects]).toEqual([1, 1, 1]);
      const before = { rows: await db.select().from(files), deleted: [...fileStore.deleted] };

      const second = await run();
      expect([second.verifiedFiles, second.abandonedFiles, second.orphanObjects]).toEqual([0, 0, 0]);
      expect(await db.select().from(files)).toEqual(before.rows);
      expect(fileStore.deleted).toEqual(before.deleted);
    });

    it("keeps users apart: each user's orphan is deleted, the other's objects and rows are not", async () => {
      const bob = crypto.randomUUID();
      await db.insert(users).values({ id: bob, email: "bob@example.com", createdAt: clock });
      await insertFile("a.mp3", clock - 2 * DAY_MS);
      await insertFile("b.mp3", clock - 2 * DAY_MS, { owner: bob });
      for (const [owner, name] of [
        [userId, "a.mp3"],
        [userId, "orphan-a.mp3"],
        [bob, "b.mp3"],
        [bob, "orphan-b.mp3"],
      ] as const) {
        fileStore.stored.add(keyFor(name, owner));
      }

      const result = await run();

      expect(result.orphanObjects).toBe(2);
      expect(fileStore.deleted.sort()).toEqual([keyFor("orphan-a.mp3"), keyFor("orphan-b.mp3", bob)].sort());
      expect(await rowNames()).toEqual(["a.mp3"]);
      expect(await rowNames(bob)).toEqual(["b.mp3"]);
    });
  });
});
