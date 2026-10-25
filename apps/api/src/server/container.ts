import path from "node:path";
import { assertMigrated, createDb, migrateDb, type Db } from "../db/client";
import { loadEnv } from "./config/env";
import { AccountService } from "./account/AccountService";
import { AuthService } from "./auth/AuthService";
import { CollectionSyncService } from "./collections/CollectionSyncService";
import { ReleaseSyncService } from "./releases/ReleaseSyncService";
import { PlayEventsService } from "./plays/PlayEventsService";
import { PlaysService } from "./plays/PlaysService";
import { QuotaService } from "./quota/QuotaService";
import { ShareService } from "./shares/ShareService";
import { CleanupService } from "./cleanup/CleanupService";
import type { Mailer } from "./mail/Mailer";
import { ConsoleMailer } from "./mail/ConsoleMailer";
import { ResendMailer } from "./mail/ResendMailer";
import type { FileStore } from "./files/FileStore";
import { LocalFileStore } from "./files/LocalFileStore";
import { VercelBlobFileStore } from "./files/VercelBlobFileStore";
import { ReleaseFilesService } from "./files/ReleaseFilesService";
import type { RateLimiter } from "./ratelimit/RateLimiter";
import { DbRateLimiter } from "./ratelimit/DbRateLimiter";
import { TokenCipher } from "./crypto/TokenCipher";
import { SpotifyLinkService } from "./spotify/SpotifyLinkService";
import { SpotifyPlayerClient } from "./spotify/SpotifyPlayerClient";
import { SpotifySampler } from "./spotify/SpotifySampler";

export interface Services {
  db: Db;
  mailer: Mailer;
  fileStore: FileStore;
  auth: AuthService;
  account: AccountService;
  releases: ReleaseSyncService;
  collections: CollectionSyncService;
  plays: PlaysService;
  playEvents: PlayEventsService;
  quota: QuotaService;
  files: ReleaseFilesService;
  cleanup: CleanupService;
  shares: ShareService;
  /** Null unless `SPOTIFY_CLIENT_ID` is set (#305); the Spotify routes answer 404 then. */
  spotify: SpotifyLinkService | null;
  /** Null unless `SPOTIFY_CLIENT_ID` is set (#306); `POST /v1/internal/spotify-sample` answers 404 then. */
  sampler: SpotifySampler | null;
  /** The bearer secret for the sampler route; set whenever `sampler` is. */
  samplerSecret: string | undefined;
  cronSecret: string | undefined;
  storageAlertBytes: number;
  /** The cleanup cron warns when share downloads in the last 24 hours reach this many bytes (#181). */
  shareEgressAlertBytes: number;
  allowedOrigins: string[];
  /**
   * Rate limiters: the two unauthenticated auth routes, keyed separately by email and by IP, and the
   * two missing-files routes, each keyed by the calling device id and capped again per user id.
   */
  rateLimiters: {
    codeByEmail: RateLimiter;
    codeByIp: RateLimiter;
    verifyByEmail: RateLimiter;
    verifyByIp: RateLimiter;
    missingFilesByDevice: RateLimiter;
    missingFilesByUser: RateLimiter;
    resyncRequestByDevice: RateLimiter;
    resyncRequestByUser: RateLimiter;
    /** `GET /v1/plays/summary`, keyed by user id. */
    playsSummary: RateLimiter;
    /** `PUT /v1/plays/events`, keyed by user id (#368). */
    playEvents: RateLimiter;
    collectionWrites: RateLimiter;
    /** `POST /v1/spotify/link`, keyed by user id (#305). */
    spotifyLink: RateLimiter;
    /** `POST /v1/shares` and `POST /v1/shares/:id/reshare`, keyed by user id (#181). */
    shareCreate: RateLimiter;
    /** `POST /v1/links/claim`, keyed by user id (#181). */
    linkClaim: RateLimiter;
    /** Every `/s/*` request, keyed by client IP (#181). */
    publicShareByIp: RateLimiter;
    /** Every `/s/:token*` request, keyed by the sha256 of the token (#181). */
    publicShareByLink: RateLimiter;
  };
}

async function buildServices(): Promise<Services> {
  const env = loadEnv();

  const db = createDb(env.databaseUrl, env.databaseAuthToken);
  if (env.migrateOnStart) await migrateDb(db);
  else await assertMigrated(db);

  const mailer: Mailer =
    env.mailer === "resend" ? new ResendMailer(env.resendApiKey, env.mailFrom) : new ConsoleMailer();

  const fileStore: FileStore =
    env.fileStore === "blob"
      ? new VercelBlobFileStore(env.blobReadWriteToken)
      : new LocalFileStore(path.join(process.cwd(), "data", "files"), env.publicBaseUrl, env.tokenPepper);

  const quota = new QuotaService(db);
  const cipher = env.spotify ? new TokenCipher(env.spotify.tokenKey) : null;

  return {
    db,
    mailer,
    fileStore,
    auth: new AuthService(db, mailer, env.authPepper, env.tokenPepper),
    account: new AccountService(db),
    releases: new ReleaseSyncService(db),
    collections: new CollectionSyncService(db),
    plays: new PlaysService(db),
    playEvents: new PlayEventsService(db),
    quota,
    files: new ReleaseFilesService(db, fileStore, quota),
    cleanup: new CleanupService(db, fileStore),
    shares: new ShareService(db, fileStore, { publicSharesEnabled: env.publicSharesEnabled }),
    spotify:
      env.spotify && cipher
        ? new SpotifyLinkService(db, cipher, { clientId: env.spotify.clientId, redirectUri: env.spotify.redirectUri })
        : null,
    sampler: env.spotify && cipher ? new SpotifySampler(db, new SpotifyPlayerClient(db, cipher, env.spotify.clientId)) : null,
    samplerSecret: env.spotify?.samplerSecret,
    cronSecret: env.cronSecret,
    storageAlertBytes: env.storageAlertBytes,
    shareEgressAlertBytes: env.shareEgressAlertBytes,
    allowedOrigins: env.allowedOrigins,
    rateLimiters: {
      // 5 code requests per email / 20 per IP, per 15 minutes.
      codeByEmail: new DbRateLimiter(db, 5, 15 * 60 * 1000, "code:email"),
      codeByIp: new DbRateLimiter(db, 20, 15 * 60 * 1000, "code:ip"),
      // 10 verify attempts per email / 30 per IP, per 15 minutes (on top of the
      // 5-guesses-per-code limit already enforced inside AuthService.verify).
      verifyByEmail: new DbRateLimiter(db, 10, 15 * 60 * 1000, "verify:email"),
      verifyByIp: new DbRateLimiter(db, 30, 15 * 60 * 1000, "verify:ip"),
      // Missing-files checks and resync requests (#119): 6 an hour per device, so a polling Mac cannot
      // starve the phone, and 24 an hour per user across devices, so many devices cannot fan out.
      missingFilesByDevice: new DbRateLimiter(db, 6, 60 * 60 * 1000, "files-missing:device"),
      missingFilesByUser: new DbRateLimiter(db, 24, 60 * 60 * 1000, "files-missing:user"),
      resyncRequestByDevice: new DbRateLimiter(db, 6, 60 * 60 * 1000, "resync-request:device"),
      resyncRequestByUser: new DbRateLimiter(db, 24, 60 * 60 * 1000, "resync-request:user"),
      // 600 plays-summary reads per user, per hour (#267), shared by the Mac (200) and the iPhone (200).
      playsSummary: new DbRateLimiter(db, 600, 60 * 60 * 1000, "plays-summary:user"),
      // 120 play-event pushes per user, per hour (#368).
      playEvents: new DbRateLimiter(db, 120, 60 * 60 * 1000, "play-events:user"),
      // 1,200 collection writes (PUT and DELETE) per user, per hour (#348).
      collectionWrites: new DbRateLimiter(db, 1200, 60 * 60 * 1000, "collection-writes:user"),
      // 10 link starts per user, per hour (#305).
      spotifyLink: new DbRateLimiter(db, 10, 60 * 60 * 1000, "spotify-link:user"),
      // Sharing (#181): 60 creates or reshares and 30 link claims per user, per hour; public pages 60 per IP
      // and 300 per link, per hour.
      shareCreate: new DbRateLimiter(db, 60, 60 * 60 * 1000, "share-create:user"),
      linkClaim: new DbRateLimiter(db, 30, 60 * 60 * 1000, "link-claim:user"),
      publicShareByIp: new DbRateLimiter(db, 60, 60 * 60 * 1000, "public-share:ip"),
      publicShareByLink: new DbRateLimiter(db, 300, 60 * 60 * 1000, "public-share:link"),
    },
  };
}

// Memoised on `globalThis` (not a module-level `let`) so Next's dev-mode hot
// reload, which re-evaluates route modules but not the process, doesn't spin
// up duplicate singletons (a second db client, a second set of in-memory
// rate limiters) on every edit-and-save. Holding a `Promise<Services>`
// (rather than awaiting before storing) means two requests that arrive
// while the first build is still migrating the database both await the
// same build instead of racing a second one. A build that rejects is dropped
// from the cache so the next call rebuilds, instead of a transient database
// error poisoning the instance for its whole life.
const GLOBAL_KEY = Symbol.for("sync-api.services");

interface GlobalWithServices {
  [GLOBAL_KEY]?: Promise<Services>;
}

/** Lazily build and memoise the app's service singletons. */
export function getServices(): Promise<Services> {
  const g = globalThis as GlobalWithServices;
  if (!g[GLOBAL_KEY]) {
    const build = buildServices();
    g[GLOBAL_KEY] = build;
    build.catch(() => {
      if (g[GLOBAL_KEY] === build) delete g[GLOBAL_KEY];
    });
  }
  return g[GLOBAL_KEY];
}
