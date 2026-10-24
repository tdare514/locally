import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDb, migrateDb } from "../../src/db/client";
import { AccountService } from "../../src/server/account/AccountService";
import { AuthService } from "../../src/server/auth/AuthService";
import { CleanupService } from "../../src/server/cleanup/CleanupService";
import type { Services } from "../../src/server/container";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { ReleaseFilesService } from "../../src/server/files/ReleaseFilesService";
import type { Mailer } from "../../src/server/mail/Mailer";
import { PlaysService } from "../../src/server/plays/PlaysService";
import { QuotaService } from "../../src/server/quota/QuotaService";
import { ShareService } from "../../src/server/shares/ShareService";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import { CollectionSyncService } from "../../src/server/collections/CollectionSyncService";
import { ReleaseSyncService } from "../../src/server/releases/ReleaseSyncService";

/**
 * Stands in for `fetch` against a `LocalFileStore` signed URL: verifies the signature and reads the file from
 * disk, so the zip tests stream real stored bytes with no network.
 */
async function fetchLocalFile(fileStore: LocalFileStore, url: string): Promise<Response> {
  const parsed = new URL(url);
  const key = decodeURIComponent(parsed.pathname.replace("/v1/internal/local-download/", ""));
  if (!fileStore.verifyDownloadSignature(key, parsed.searchParams.get("exp"), parsed.searchParams.get("sig"))) {
    return new Response("forbidden", { status: 403 });
  }
  const data = await fileStore.readFile(key);
  return data ? new Response(new Uint8Array(data)) : new Response("missing", { status: 404 });
}

/** Records every code it "sends" instead of emailing it, so tests can read it straight back. */
export class FakeMailer implements Mailer {
  public lastCode: string | null = null;
  private readonly codesByEmail = new Map<string, string>();

  async sendCode(email: string, code: string): Promise<void> {
    this.lastCode = code;
    this.codesByEmail.set(email, code);
  }

  codeFor(email: string): string {
    const code = this.codesByEmail.get(email);
    if (!code) throw new Error(`No code was sent to ${email}`);
    return code;
  }
}

export interface TestServices extends Services {
  mailer: FakeMailer;
  fileStoreDir: string;
}

/**
 * Builds a full `Services` graph against an isolated `:memory:` database and
 * a temp-dir `LocalFileStore`, exactly like `container.ts`'s `buildServices`
 * but without touching real env vars or process-wide singletons. Rate
 * limiters use generous limits so route-level tests aren't flaky (except the missing-files
 * ones, which keep their real limits); the limiter
 * itself is covered by `InMemoryRateLimiter.test.ts`.
 */
export async function createTestServices(): Promise<TestServices> {
  const db = createDb(":memory:");
  await migrateDb(db);

  const fileStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-api-files-"));
  const mailer = new FakeMailer();
  const fileStore = new LocalFileStore(fileStoreDir, "http://localhost:4000", "test-token-pepper");
  const quota = new QuotaService(db);

  return {
    db,
    mailer,
    fileStore,
    fileStoreDir,
    auth: new AuthService(db, mailer, "test-auth-pepper", "test-token-pepper"),
    account: new AccountService(db),
    releases: new ReleaseSyncService(db),
    collections: new CollectionSyncService(db),
    plays: new PlaysService(db),
    quota,
    files: new ReleaseFilesService(db, fileStore, quota),
    cleanup: new CleanupService(db, fileStore),
    shares: new ShareService(db, fileStore, { publicSharesEnabled: true, fetchFile: (url) => fetchLocalFile(fileStore, url) }),
    spotify: null,
    sampler: null,
    samplerSecret: undefined,
    cronSecret: undefined,
    storageAlertBytes: 50 * 1024 * 1024 * 1024,
    shareEgressAlertBytes: 20 * 1024 * 1024 * 1024,
    allowedOrigins: ["http://localhost:*"],
    rateLimiters: {
      codeByEmail: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      codeByIp: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      verifyByEmail: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      verifyByIp: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      // The real limits: keyed by device id and user id, so tests that make a fresh user never collide.
      missingFilesByDevice: new InMemoryRateLimiter(6, 60 * 60 * 1000),
      missingFilesByUser: new InMemoryRateLimiter(24, 60 * 60 * 1000),
      resyncRequestByDevice: new InMemoryRateLimiter(6, 60 * 60 * 1000),
      resyncRequestByUser: new InMemoryRateLimiter(24, 60 * 60 * 1000),
      playsSummary: new InMemoryRateLimiter(1000, 60 * 60 * 1000),
      spotifyLink: new InMemoryRateLimiter(10, 60 * 60 * 1000),
      // Generous here; the share rate-limit tests swap in the real limits (60, 30, 60, 300).
      shareCreate: new InMemoryRateLimiter(1000, 60 * 60 * 1000),
      linkClaim: new InMemoryRateLimiter(1000, 60 * 60 * 1000),
      publicShareByIp: new InMemoryRateLimiter(10_000, 60 * 60 * 1000),
      publicShareByLink: new InMemoryRateLimiter(10_000, 60 * 60 * 1000),
    },
  };
}

export async function cleanupTestServices(services: TestServices): Promise<void> {
  await fs.rm(services.fileStoreDir, { recursive: true, force: true });
}
