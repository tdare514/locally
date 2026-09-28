import path from "node:path";
import { createDb, migrateDb, type Db } from "../db/client";
import { loadEnv } from "./config/env";
import { AuthService } from "./auth/AuthService";
import { ReleaseSyncService } from "./releases/ReleaseSyncService";
import { QuotaService } from "./quota/QuotaService";
import { CleanupService } from "./cleanup/CleanupService";
import type { Mailer } from "./mail/Mailer";
import { ConsoleMailer } from "./mail/ConsoleMailer";
import { ResendMailer } from "./mail/ResendMailer";
import type { FileStore } from "./files/FileStore";
import { LocalFileStore } from "./files/LocalFileStore";
import { VercelBlobFileStore } from "./files/VercelBlobFileStore";
import { ReleaseFilesService } from "./files/ReleaseFilesService";
import type { RateLimiter } from "./ratelimit/RateLimiter";
import { InMemoryRateLimiter } from "./ratelimit/InMemoryRateLimiter";

export interface Services {
  db: Db;
  mailer: Mailer;
  fileStore: FileStore;
  auth: AuthService;
  releases: ReleaseSyncService;
  quota: QuotaService;
  files: ReleaseFilesService;
  cleanup: CleanupService;
  cronSecret: string | undefined;
  allowedOrigins: string[];
  /** Sliding-window rate limiters for the two unauthenticated auth routes, keyed separately by email and by IP. */
  rateLimiters: {
    codeByEmail: RateLimiter;
    codeByIp: RateLimiter;
    verifyByEmail: RateLimiter;
    verifyByIp: RateLimiter;
  };
}

async function buildServices(): Promise<Services> {
  const env = loadEnv();

  const db = createDb(env.databaseUrl);
  await migrateDb(db);

  const mailer: Mailer =
    env.mailer === "resend" ? new ResendMailer(env.resendApiKey, env.mailFrom) : new ConsoleMailer();

  const fileStore: FileStore =
    env.fileStore === "blob"
      ? new VercelBlobFileStore(env.blobReadWriteToken)
      : new LocalFileStore(path.join(process.cwd(), "data", "files"), env.publicBaseUrl, env.tokenPepper);

  const quota = new QuotaService(db);

  return {
    db,
    mailer,
    fileStore,
    auth: new AuthService(db, mailer, env.authPepper, env.tokenPepper),
    releases: new ReleaseSyncService(db),
    quota,
    files: new ReleaseFilesService(db, fileStore, quota),
    cleanup: new CleanupService(db, fileStore),
    cronSecret: env.cronSecret,
    allowedOrigins: env.allowedOrigins,
    rateLimiters: {
      // 5 code requests per email / 20 per IP, per 15 minutes.
      codeByEmail: new InMemoryRateLimiter(5, 15 * 60 * 1000),
      codeByIp: new InMemoryRateLimiter(20, 15 * 60 * 1000),
      // 10 verify attempts per email / 30 per IP, per 15 minutes (on top of the
      // 5-guesses-per-code limit already enforced inside AuthService.verify).
      verifyByEmail: new InMemoryRateLimiter(10, 15 * 60 * 1000),
      verifyByIp: new InMemoryRateLimiter(30, 15 * 60 * 1000),
    },
  };
}

// Memoised on `globalThis` (not a module-level `let`) so Next's dev-mode hot
// reload, which re-evaluates route modules but not the process, doesn't spin
// up duplicate singletons (a second db client, a second set of in-memory
// rate limiters) on every edit-and-save. Holding a `Promise<Services>`
// (rather than awaiting before storing) means two requests that arrive
// while the first build is still migrating the database both await the
// same build instead of racing a second one.
const GLOBAL_KEY = Symbol.for("sync-api.services");

interface GlobalWithServices {
  [GLOBAL_KEY]?: Promise<Services>;
}

/** Lazily build and memoise the app's service singletons. */
export function getServices(): Promise<Services> {
  const g = globalThis as GlobalWithServices;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = buildServices();
  }
  return g[GLOBAL_KEY];
}
