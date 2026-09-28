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
import { QuotaService } from "../../src/server/quota/QuotaService";
import { InMemoryRateLimiter } from "../../src/server/ratelimit/InMemoryRateLimiter";
import { ReleaseSyncService } from "../../src/server/releases/ReleaseSyncService";

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
 * limiters use generous limits so route-level tests aren't flaky; the limiter
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
    quota,
    files: new ReleaseFilesService(db, fileStore, quota),
    cleanup: new CleanupService(db, fileStore),
    cronSecret: undefined,
    storageAlertBytes: 50 * 1024 * 1024 * 1024,
    allowedOrigins: ["http://localhost:*"],
    rateLimiters: {
      codeByEmail: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      codeByIp: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      verifyByEmail: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
      verifyByIp: new InMemoryRateLimiter(1000, 15 * 60 * 1000),
    },
  };
}

export async function cleanupTestServices(services: TestServices): Promise<void> {
  await fs.rm(services.fileStoreDir, { recursive: true, force: true });
}
