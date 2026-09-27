import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { files, users } from "../../src/db/schema";
import { MAX_FILE_BYTES, QuotaService } from "../../src/server/quota/QuotaService";
import { NotFoundError, ValidationError } from "../../src/shared/errors";

describe("QuotaService", () => {
  let db: Db;
  let quota: QuotaService;
  const userId = crypto.randomUUID();

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateDb(db);
    quota = new QuotaService(db);
    await db.insert(users).values({
      id: userId,
      email: "person@example.com",
      createdAt: Date.now(),
      storageLimitBytes: 1000,
    });
  });

  async function addFile(bytes: number): Promise<void> {
    await db.insert(files).values({
      id: crypto.randomUUID(),
      releaseId: crypto.randomUUID(),
      userId,
      name: "track.mp3",
      bytes,
      contentType: "audio/mpeg",
      storageKey: `users/${userId}/releases/x/track-${crypto.randomUUID()}.mp3`,
      createdAt: Date.now(),
    });
  }

  it("sums bytes across a user's files", async () => {
    await addFile(100);
    await addFile(250);
    expect(await quota.usedBytes(userId)).toBe(350);
  });

  it("returns 0 for a user with no files", async () => {
    expect(await quota.usedBytes(userId)).toBe(0);
  });

  it("does not count another user's files", async () => {
    const otherUser = crypto.randomUUID();
    await db.insert(users).values({ id: otherUser, email: "other@example.com", createdAt: Date.now() });
    await db.insert(files).values({
      id: crypto.randomUUID(),
      releaseId: crypto.randomUUID(),
      userId: otherUser,
      name: "track.mp3",
      bytes: 999,
      contentType: "audio/mpeg",
      storageKey: `users/${otherUser}/releases/x/track.mp3`,
      createdAt: Date.now(),
    });

    expect(await quota.usedBytes(userId)).toBe(0);
  });

  it("reads the account's storage limit, and 404s for an unknown user", async () => {
    expect(await quota.limitBytes(userId)).toBe(1000);
    await expect(quota.limitBytes(crypto.randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("rejects a file over the per-file cap", () => {
    expect(() => quota.assertFileSizes([MAX_FILE_BYTES + 1])).toThrow(ValidationError);
    expect(() => quota.assertFileSizes([MAX_FILE_BYTES])).not.toThrow();
  });

  it("rejects a write that would exceed the account quota", async () => {
    await addFile(900);
    await expect(quota.assertWithinQuota(userId, 101)).rejects.toThrow(ValidationError);
    await expect(quota.assertWithinQuota(userId, 100)).resolves.toBeUndefined();
  });
});
