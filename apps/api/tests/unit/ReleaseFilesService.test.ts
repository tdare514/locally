import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import type { CreateUploadParams, FileStore, UploadTicket } from "../../src/server/files/FileStore";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { ReleaseFilesService, storageKeyFor } from "../../src/server/files/ReleaseFilesService";
import { MAX_FILE_BYTES, QuotaService } from "../../src/server/quota/QuotaService";
import { NotFoundError, ValidationError } from "../../src/shared/errors";
import type { DownloadTicket } from "../../src/shared/types";

/** In-memory `FileStore` fake, so this suite tests only the service's own bookkeeping. */
class FakeFileStore implements FileStore {
  public created: CreateUploadParams[] = [];
  public deleted: string[] = [];

  async createUpload(params: CreateUploadParams): Promise<UploadTicket> {
    this.created.push(params);
    return { url: `https://fake.local/${params.key}`, method: "PUT", headers: { "Content-Type": params.contentType } };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    return { url: `https://fake.local/${key}`, expiresAt: new Date(Date.now() + 1000).toISOString() };
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    this.deleted.push(...keys);
  }
}

describe("ReleaseFilesService", () => {
  let db: Db;
  let store: FakeFileStore;
  let service: ReleaseFilesService;
  const userId = crypto.randomUUID();
  const releaseId = crypto.randomUUID();

  beforeEach(async () => {
    db = createDb(":memory:");
    await migrateDb(db);
    await db
      .insert(users)
      .values({ id: userId, email: "person@example.com", createdAt: Date.now(), storageLimitBytes: 1_000_000 });
    store = new FakeFileStore();
    service = new ReleaseFilesService(db, store, new QuotaService(db));
  });

  it("issues an upload ticket per file, with a server-built storage key", async () => {
    const tickets = await service.createUploads(userId, releaseId, [
      { name: "01 - Track.mp3", bytes: 1000, contentType: "audio/mpeg" },
    ]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.name).toBe("01 - Track.mp3");
    expect(tickets[0]?.method).toBe("PUT");
    expect(store.created[0]?.key).toBe(`users/${userId}/releases/${releaseId}/01 - Track.mp3`);
  });

  it("rejects a file over the per-file cap", async () => {
    await expect(
      service.createUploads(userId, releaseId, [
        { name: "big.mp3", bytes: MAX_FILE_BYTES + 1, contentType: "audio/mpeg" },
      ])
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a request that would exceed the account quota", async () => {
    await expect(
      service.createUploads(userId, releaseId, [
        { name: "huge.mp3", bytes: 2_000_000, contentType: "audio/mpeg" },
      ])
    ).rejects.toThrow(ValidationError);
  });

  it("only counts net-new bytes when re-registering the same file name", async () => {
    await service.createUploads(userId, releaseId, [
      { name: "track.mp3", bytes: 900_000, contentType: "audio/mpeg" },
    ]);
    // Same name, similar size: must not be counted as 900k + 950k (would exceed the 1M limit).
    await expect(
      service.createUploads(userId, releaseId, [{ name: "track.mp3", bytes: 950_000, contentType: "audio/mpeg" }])
    ).resolves.toHaveLength(1);
  });

  it("404s a download for a file that was never registered", async () => {
    await expect(service.createDownload(userId, releaseId, "missing.mp3")).rejects.toThrow(NotFoundError);
  });

  it("returns a download ticket for a registered file", async () => {
    await service.createUploads(userId, releaseId, [{ name: "track.mp3", bytes: 100, contentType: "audio/mpeg" }]);
    const ticket = await service.createDownload(userId, releaseId, "track.mp3");
    expect(ticket.url).toContain("track.mp3");
  });

  it("accepts a content type that matches the file's extension", async () => {
    await expect(
      service.createUploads(userId, releaseId, [{ name: "track.mp3", bytes: 100, contentType: "audio/mpeg" }])
    ).resolves.toHaveLength(1);
  });

  it("rejects a content type that doesn't match the file's extension", async () => {
    await expect(
      service.createUploads(userId, releaseId, [{ name: "cover.jpg", bytes: 100, contentType: "text/html" }])
    ).rejects.toThrow(ValidationError);
  });

  it("lets only one of two concurrent requests through when together they exceed the quota", async () => {
    // Each 600k request fits the 1M quota alone; together they do not.
    const results = await Promise.allSettled([
      service.createUploads(userId, releaseId, [{ name: "a.mp3", bytes: 600_000, contentType: "audio/mpeg" }]),
      service.createUploads(userId, crypto.randomUUID(), [{ name: "b.mp3", bytes: 600_000, contentType: "audio/mpeg" }]),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ValidationError);
    expect((rejected[0]?.reason as Error).message).toBe("Storage quota exceeded");
    expect(await new QuotaService(db).usedBytes(userId)).toBe(600_000);
    expect(store.created).toHaveLength(1);
  });

  describe("pruneUnreferenced", () => {
    let rootDir: string;
    let realStore: LocalFileStore;
    let realService: ReleaseFilesService;

    beforeEach(async () => {
      rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-prune-test-"));
      realStore = new LocalFileStore(rootDir, "http://localhost:4000", "test-token-pepper");
      realService = new ReleaseFilesService(db, realStore, new QuotaService(db));
    });

    afterEach(async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    });

    it("deletes a file's row and storage object when it's no longer referenced, keeping the rest", async () => {
      await realService.createUploads(userId, releaseId, [
        { name: "keep.mp3", bytes: 10, contentType: "audio/mpeg" },
        { name: "drop.mp3", bytes: 10, contentType: "audio/mpeg" },
      ]);
      await realStore.writeFromRequest(
        storageKeyFor(userId, releaseId, "keep.mp3"),
        new Response(new Uint8Array(Buffer.from("keep bytes"))).body,
        1000
      );
      await realStore.writeFromRequest(
        storageKeyFor(userId, releaseId, "drop.mp3"),
        new Response(new Uint8Array(Buffer.from("drop bytes"))).body,
        1000
      );

      const pruned = await realService.pruneUnreferenced(userId, releaseId, ["keep.mp3"]);
      expect(pruned).toBe(1);

      expect(await realStore.readFile(storageKeyFor(userId, releaseId, "drop.mp3"))).toBeNull();
      expect(await realStore.readFile(storageKeyFor(userId, releaseId, "keep.mp3"))).not.toBeNull();

      await expect(realService.createDownload(userId, releaseId, "drop.mp3")).rejects.toThrow(NotFoundError);
      await expect(realService.createDownload(userId, releaseId, "keep.mp3")).resolves.toBeDefined();
    });

    it("with an empty keep list, prunes every file registered for the release", async () => {
      await realService.createUploads(userId, releaseId, [{ name: "only.mp3", bytes: 10, contentType: "audio/mpeg" }]);
      await realStore.writeFromRequest(
        storageKeyFor(userId, releaseId, "only.mp3"),
        new Response(new Uint8Array(Buffer.from("bytes"))).body,
        1000
      );

      const pruned = await realService.pruneUnreferenced(userId, releaseId, []);
      expect(pruned).toBe(1);
      expect(await realStore.readFile(storageKeyFor(userId, releaseId, "only.mp3"))).toBeNull();
    });
  });
});
