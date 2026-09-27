import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, migrateDb, type Db } from "../../src/db/client";
import { users } from "../../src/db/schema";
import type { CreateUploadParams, FileStore, UploadTicket } from "../../src/server/files/FileStore";
import { ReleaseFilesService } from "../../src/server/files/ReleaseFilesService";
import { MAX_FILE_BYTES, QuotaService } from "../../src/server/quota/QuotaService";
import { NotFoundError, ValidationError } from "../../src/shared/errors";
import type { DownloadTicket } from "../../src/shared/types";

/** In-memory `FileStore` fake, so this suite tests only the service's own bookkeeping. */
class FakeFileStore implements FileStore {
  public created: CreateUploadParams[] = [];

  async createUpload(params: CreateUploadParams): Promise<UploadTicket> {
    this.created.push(params);
    return { url: `https://fake.local/${params.key}`, method: "PUT", headers: { "Content-Type": params.contentType } };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    return { url: `https://fake.local/${key}`, expiresAt: new Date(Date.now() + 1000).toISOString() };
  }

  async delete(): Promise<void> {}
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
});
