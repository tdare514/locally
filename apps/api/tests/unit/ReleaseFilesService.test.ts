import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import type { CreateUploadParams, FileStore, UploadTicket } from "../../src/server/files/FileStore";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { expectedContentTypeFor } from "../../src/server/files/contentTypes";
import { ReleaseFilesService, storageKeyFor, userStoragePrefix } from "../../src/server/files/ReleaseFilesService";
import { MAX_FILE_BYTES, QuotaService } from "../../src/server/quota/QuotaService";
import { ReleaseSyncService } from "../../src/server/releases/ReleaseSyncService";
import { NotFoundError, ValidationError } from "../../src/shared/errors";
import type { DownloadTicket, ReleaseRecord } from "../../src/shared/types";
import { makeReleaseRecord } from "../support/fixtures";

/** In-memory `FileStore` fake, so this suite tests only the service's own bookkeeping. */
class FakeFileStore implements FileStore {
  public created: CreateUploadParams[] = [];
  public deleted: string[] = [];
  /** Keys `listKeys` reports as stored, standing in for blobs that finished uploading. */
  public stored = new Set<string>();
  /** The prefix of every `listKeys` call, in order. */
  public listed: string[] = [];

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

  async *listKeys(prefix: string): AsyncGenerator<string> {
    this.listed.push(prefix);
    for (const key of this.stored) if (key.startsWith(prefix)) yield key;
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

  describe("missingFiles", () => {
    const CLOCK = Date.UTC(2026, 9, 15, 12, 0, 0);
    const coverHash = "a".repeat(64);
    const otherUserId = crypto.randomUUID();
    let releaseSync: ReleaseSyncService;
    let checker: ReleaseFilesService;

    beforeEach(async () => {
      releaseSync = new ReleaseSyncService(db);
      checker = new ReleaseFilesService(db, store, new QuotaService(db), () => CLOCK);
      await db
        .insert(users)
        .values({ id: otherUserId, email: "other@example.com", createdAt: Date.now(), storageLimitBytes: 1_000_000 });
    });

    async function pushRelease(owner: string, overrides: Partial<ReleaseRecord> = {}): Promise<ReleaseRecord> {
      const record = makeReleaseRecord(overrides);
      await releaseSync.upsert(owner, record.id, record);
      return record;
    }

    /** A ticket was issued for each name: this is what writes the `files` rows. */
    async function issueTickets(owner: string, record: ReleaseRecord, names: string[]): Promise<void> {
      await service.createUploads(
        owner,
        record.id,
        names.map((name) => ({ name, bytes: 10, contentType: expectedContentTypeFor(name)! }))
      );
    }

    /** The bytes reached storage. */
    function land(owner: string, record: ReleaseRecord, names: string[]): void {
      for (const name of names) store.stored.add(storageKeyFor(owner, record.id, name));
    }

    it("builds the per-user prefix every one of that user's keys starts with, and no other user's", () => {
      expect(storageKeyFor(userId, releaseId, "a.mp3").startsWith(userStoragePrefix(userId))).toBe(true);
      expect(storageKeyFor(otherUserId, releaseId, "a.mp3").startsWith(userStoragePrefix(userId))).toBe(false);
    });

    it("returns no releases for an account with none, without listing storage", async () => {
      expect(await checker.missingFiles(userId)).toEqual({ releases: [], checkedAt: new Date(CLOCK).toISOString() });
      expect(store.listed).toEqual([]);
    });

    it("reports a name with no files row as missing, without a priced listing", async () => {
      const record = await pushRelease(userId);
      const result = await checker.missingFiles(userId);
      expect(result.releases).toEqual([
        { id: record.id, missing: [record.tracks[0]!.file], recordUpdatedAt: record.updatedAt },
      ]);
      expect(store.listed).toEqual([]);
    });

    it("reports a name whose row exists but whose blob never landed as missing", async () => {
      const record = await pushRelease(userId);
      await issueTickets(userId, record, [record.tracks[0]!.file]);
      const result = await checker.missingFiles(userId);
      expect(result.releases).toEqual([
        { id: record.id, missing: [record.tracks[0]!.file], recordUpdatedAt: record.updatedAt },
      ]);
      expect(store.listed).toEqual([userStoragePrefix(userId)]);
    });

    it("treats a name with both a row and a blob as stored, and leaves the release out", async () => {
      const record = await pushRelease(userId);
      await issueTickets(userId, record, [record.tracks[0]!.file]);
      land(userId, record, [record.tracks[0]!.file]);
      expect(await checker.missingFiles(userId)).toEqual({ releases: [], checkedAt: new Date(CLOCK).toISOString() });
    });

    it("treats a blob with no files row as missing", async () => {
      const record = await pushRelease(userId);
      land(userId, record, [record.tracks[0]!.file]);
      expect((await checker.missingFiles(userId)).releases).toHaveLength(1);
    });

    it("lists only the names that are missing, in record order, and only for releases that need it", async () => {
      const base = makeReleaseRecord();
      const track = (n: number, file: string) => ({ ...base.tracks[0]!, id: crypto.randomUUID(), trackNumber: n, file });
      const album = await pushRelease(userId, {
        kind: "album",
        tracks: [track(1, "01 - A.mp3"), track(2, "02 - B.mp3"), track(3, "03 - C.mp3")],
      });
      const healthy = await pushRelease(userId);
      await issueTickets(userId, album, ["01 - A.mp3", "02 - B.mp3"]);
      land(userId, album, ["01 - A.mp3"]);
      await issueTickets(userId, healthy, [healthy.tracks[0]!.file]);
      land(userId, healthy, [healthy.tracks[0]!.file]);

      const result = await checker.missingFiles(userId);
      expect(result.releases).toEqual([
        { id: album.id, missing: ["02 - B.mp3", "03 - C.mp3"], recordUpdatedAt: album.updatedAt },
      ]);
      expect(store.listed).toHaveLength(1);
    });

    it("names a file once even when two tracks point at it", async () => {
      const base = makeReleaseRecord();
      const record = await pushRelease(userId, {
        tracks: [base.tracks[0]!, { ...base.tracks[0]!, id: crypto.randomUUID(), trackNumber: 2 }],
      });
      expect((await checker.missingFiles(userId)).releases[0]?.missing).toEqual([record.tracks[0]!.file]);
    });

    it("excludes tombstoned releases", async () => {
      const record = await pushRelease(userId);
      await releaseSync.tombstone(userId, record.id);
      expect((await checker.missingFiles(userId)).releases).toEqual([]);
      expect(store.listed).toEqual([]);
    });

    describe("the cover", () => {
      it("is included when the record has a coverHash", async () => {
        const record = await pushRelease(userId, { syncVersion: 2, cover: "cover.jpg", coverHash });
        await issueTickets(userId, record, [record.tracks[0]!.file]);
        land(userId, record, [record.tracks[0]!.file]);
        expect((await checker.missingFiles(userId)).releases).toEqual([
          { id: record.id, missing: ["cover.jpg"], recordUpdatedAt: record.updatedAt },
        ]);

        await issueTickets(userId, record, ["cover.jpg"]);
        expect((await checker.missingFiles(userId)).releases).toHaveLength(1);

        land(userId, record, ["cover.jpg"]);
        expect((await checker.missingFiles(userId)).releases).toEqual([]);
      });

      it("is not required when the record has no coverHash (a syncVersion 1 record)", async () => {
        const record = await pushRelease(userId, { syncVersion: 1, cover: "cover.jpg" });
        await issueTickets(userId, record, [record.tracks[0]!.file]);
        land(userId, record, [record.tracks[0]!.file]);
        expect((await checker.missingFiles(userId)).releases).toEqual([]);
      });

      it("is not required when coverHash is null (a v2 record with no cover)", async () => {
        const record = await pushRelease(userId, { syncVersion: 2, cover: null, coverHash: null });
        await issueTickets(userId, record, [record.tracks[0]!.file]);
        land(userId, record, [record.tracks[0]!.file]);
        expect((await checker.missingFiles(userId)).releases).toEqual([]);
      });
    });

    describe("isolation", () => {
      it("never reports another account's releases", async () => {
        await pushRelease(otherUserId);
        expect((await checker.missingFiles(userId)).releases).toEqual([]);
        expect(store.listed).toEqual([]);
      });

      it("does not count another account's blob as this account's", async () => {
        const record = await pushRelease(userId);
        await issueTickets(userId, record, [record.tracks[0]!.file]);
        land(otherUserId, record, [record.tracks[0]!.file]);
        expect((await checker.missingFiles(userId)).releases).toHaveLength(1);
        expect(store.listed).toEqual([userStoragePrefix(userId)]);
      });
    });
  });

  describe("resync request", () => {
    const otherUserId = crypto.randomUUID();

    beforeEach(async () => {
      await db
        .insert(users)
        .values({ id: otherUserId, email: "other@example.com", createdAt: Date.now(), storageLimitBytes: 1_000_000 });
    });

    it("is null until a request is made, then holds the request time", async () => {
      let clock = Date.UTC(2026, 9, 15, 12, 0, 0);
      const timed = new ReleaseFilesService(db, store, new QuotaService(db), () => clock);
      expect(await timed.resyncRequestedAt(userId)).toBeNull();

      expect(await timed.requestResync(userId)).toBe("2026-10-15T12:00:00.000Z");
      expect(await timed.resyncRequestedAt(userId)).toBe("2026-10-15T12:00:00.000Z");

      clock += 60_000;
      await timed.requestResync(userId);
      expect(await timed.resyncRequestedAt(userId)).toBe("2026-10-15T12:01:00.000Z");
    });

    it("only touches the requesting account", async () => {
      await service.requestResync(userId);
      expect(await service.resyncRequestedAt(otherUserId)).toBeNull();
    });
  });
});
