import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";
import type { CollectionRecord } from "../shared/collections";
import type { ReleaseRecord, ShareSnapshot } from "../shared/types";

/** 1 GiB, the default free-tier storage limit for a new account. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  storageLimitBytes: integer("storage_limit_bytes").notNull().default(DEFAULT_STORAGE_LIMIT_BYTES),
  /** Epoch ms of the last `POST /v1/files/resync-request`; `null` until one is made. Read back by `GET /v1/me`. */
  resyncRequestedAt: integer("resync_requested_at"),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const authCodes = sqliteTable("auth_codes", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: integer("consumed_at"),
}, (table) => ({
  emailIdx: index("auth_codes_email_idx").on(table.email),
}));

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  platform: text("platform", { enum: ["mac", "ios", "cloud"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
  /** A Mac's stable install ID (#210); null for phones and for rows made before it. */
  installId: text("install_id"),
}, (table) => ({
  tokenHashIdx: uniqueIndex("devices_token_hash_idx").on(table.tokenHash),
  userIdx: index("devices_user_idx").on(table.userId),
  userInstallIdx: index("devices_user_install_idx").on(table.userId, table.installId),
}));

/** Per-user monotonic version counter, bumped once per release write (create, update, or tombstone). */
export const userCounters = sqliteTable("user_counters", {
  userId: text("user_id").primaryKey(),
  version: integer("version").notNull().default(0),
});

export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  version: integer("version").notNull(),
  /** The full `ReleaseRecord` (see shared/types.ts), serialized as JSON. */
  record: text("record", { mode: "json" }).notNull().$type<ReleaseRecord>(),
  /** Epoch ms mirror of `record.updatedAt`, used for the last-writer-wins compare. */
  updatedAt: integer("updated_at").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  serverUpdatedAt: integer("server_updated_at").notNull(),
}, (table) => ({
  userVersionIdx: index("releases_user_version_idx").on(table.userId, table.version),
  deletedIdx: index("releases_deleted_idx").on(table.deleted, table.serverUpdatedAt),
}));

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  version: integer("version").notNull(),
  /** The full `CollectionRecord` (see shared/collections.ts), serialized as JSON. */
  record: text("record", { mode: "json" }).notNull().$type<CollectionRecord>(),
  /** Epoch ms mirror of `record.updatedAt`, used for the last-writer-wins compare. */
  updatedAt: integer("updated_at").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  serverUpdatedAt: integer("server_updated_at").notNull(),
}, (table) => ({
  userVersionIdx: index("collections_user_version_idx").on(table.userId, table.version),
  deletedIdx: index("collections_deleted_idx").on(table.deleted, table.serverUpdatedAt),
}));

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  releaseId: text("release_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  bytes: integer("bytes").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: integer("created_at").notNull(),
  /** Set (ms) once the daily cleanup has seen the object in storage (#89); null until then. */
  verifiedAt: integer("verified_at"),
}, (table) => ({
  storageKeyIdx: uniqueIndex("files_storage_key_idx").on(table.storageKey),
  releaseNameIdx: uniqueIndex("files_release_name_idx").on(table.releaseId, table.name),
  userIdx: index("files_user_idx").on(table.userId),
  unverifiedIdx: index("files_unverified_idx").on(table.verifiedAt, table.createdAt).where(sql`${table.verifiedAt} IS NULL`),
}));

/**
 * A device's absolute lifetime play count for one track (`PlaysService`). The
 * device belongs to exactly one user, so (`deviceId`, `trackId`) is already
 * user-scoped; `userId` and `releaseId` are stored for scoped reads and cleanup.
 * `trackId` is not checked against the release record's tracks.
 */
export const playCounts = sqliteTable("play_counts", {
  userId: text("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  releaseId: text("release_id").notNull(),
  trackId: text("track_id").notNull(),
  /** `spotify` or `locally` (#340); rows from before the column are `spotify`. */
  source: text("source").notNull().default("spotify"),
  count: integer("count").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.deviceId, table.trackId, table.source] }),
  userReleaseIdx: index("play_counts_user_release_idx").on(table.userId, table.releaseId),
}));

/**
 * A device's absolute play count for one track on one calendar day
 * (`PlaysService`, `spec/sync.md` "Play counts"). `day` is the client's local
 * date, `YYYY-MM-DD`, stored as sent. Rows older than 400 days are deleted by
 * the daily cleanup. Columns mirror `play_counts`.
 */
export const playDays = sqliteTable("play_days", {
  userId: text("user_id").notNull(),
  deviceId: text("device_id").notNull(),
  releaseId: text("release_id").notNull(),
  trackId: text("track_id").notNull(),
  day: text("day").notNull(),
  /** `spotify` or `locally` (#340). */
  source: text("source").notNull().default("spotify"),
  count: integer("count").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.deviceId, table.trackId, table.source, table.day] }),
  userDayIdx: index("play_days_user_day_idx").on(table.userId, table.day),
}));

/**
 * One counted play with its start time and audible length (#368; `spec/sync.md`, "Play events"). Keyed per
 * account, so another account's id is a separate row. Fixed fields never change after the first write;
 * only `listened_ms` (max-merged) and `updated_at` do. Deleted with the user by a trigger (migration 0013).
 */
export const playEvents = sqliteTable("play_events", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  deviceId: text("device_id").notNull(),
  releaseId: text("release_id").notNull(),
  trackId: text("track_id").notNull(),
  source: text("source").notNull(),
  startedAt: integer("started_at").notNull(),
  day: text("day").notNull(),
  listenedMs: integer("listened_ms").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.id] }),
  userStartedIdx: index("play_events_user_started_idx").on(table.userId, table.startedAt),
  userReleaseIdx: index("play_events_user_release_idx").on(table.userId, table.releaseId),
  userDayIdx: index("play_events_user_day_idx").on(table.userId, table.day),
}));

/** Shared-store counters behind `DbRateLimiter` (see `src/server/ratelimit`). */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});

/**
 * A blob queued for deletion because its account was deleted (`AccountService`).
 * `storageKey` values are copied from `files.storageKey` inside the same
 * transaction that removes the account's rows, so the queue is the
 * complete, durable list of blobs still owed a delete. Drained by the
 * account route's background pass and, as the guarantee, by
 * `CleanupService`'s daily cron step (see spec/sync.md, "Account deletion").
 */
export const pendingDeletes = sqliteTable("pending_deletes", {
  storageKey: text("storage_key").primaryKey(),
  enqueuedAt: integer("enqueued_at").notNull(),
  /** Bumped on a failed delete attempt, for logging only — never gates a retry. */
  attempts: integer("attempts").notNull().default(0),
});

/**
 * One Spotify link per user for the sync service's own grant (#305). Both tokens are AES-256-GCM
 * ciphertexts (`server/crypto/TokenCipher.ts`) bound to the user id. `cloudDeviceId` is the user's "cloud" device (#306).
 */
export const spotifyLinks = sqliteTable("spotify_links", {
  userId: text("user_id").primaryKey().references(() => users.id),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  /** Epoch ms. */
  accessExpiresAt: integer("access_expires_at").notNull(),
  scope: text("scope").notNull(),
  timeZone: text("time_zone").notNull(),
  cloudDeviceId: text("cloud_device_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastSampleAt: integer("last_sample_at"),
  problem: text("problem"),
  backoffUntil: integer("backoff_until"),
  /** The last sample's Locally track (#306): null when nothing local is playing. Epoch ms for `sessionAt`. */
  sessionUri: text("session_uri"),
  sessionReleaseId: text("session_release_id"),
  sessionTrackId: text("session_track_id"),
  sessionProgressMs: integer("session_progress_ms"),
  sessionDurationMs: integer("session_duration_ms"),
  sessionAt: integer("session_at"),
  sessionCounted: integer("session_counted", { mode: "boolean" }),
});

/** Single-row lease so two sampler runs never overlap (#306): a run takes it with a conditional upsert. */
export const samplerLease = sqliteTable("sampler_lease", {
  id: text("id").primaryKey(),
  until: integer("until").notNull(),
});

/** A pending OAuth link request: single use, 10 minutes, keyed by the sha256 hex of its state. */
export const spotifyLinkRequests = sqliteTable("spotify_link_requests", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id").notNull(),
  verifier: text("verifier").notNull(),
  timeZone: text("time_zone").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * A share of a release (or some of its tracks) to named people and/or a public link (#146, #181). The files are
 * never copied: a share points at the root owner's stored files by `releaseId` and `fileOwnerUserId`. A reshare
 * is a child (`parentShareId`, `depth` 1 to 3) owned by the recipient that points at the same files.
 * Times are epoch ms.
 */
export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  releaseId: text("release_id").notNull(),
  /** The root owner of the stored files; equal to `ownerUserId` on an original share, inherited by every child. */
  fileOwnerUserId: text("file_owner_user_id").notNull(),
  parentShareId: text("parent_share_id"),
  /** 0 for an original share, parent's + 1 for a reshare. */
  depth: integer("depth").notNull().default(0),
  /** The shared track ids, or null for the whole release. */
  trackIdsJson: text("track_ids_json", { mode: "json" }).$type<string[] | null>(),
  visibility: text("visibility", { enum: ["private", "public"] }).notNull(),
  allowReshare: integer("allow_reshare", { mode: "boolean" }).notNull(),
  expiresAt: integer("expires_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
  /** The release's own fields at share time (see `ShareSnapshot`), with `tracks` filtered to the shared ones. */
  snapshotJson: text("snapshot_json", { mode: "json" }).notNull().$type<ShareSnapshot>(),
}, (table) => ({
  ownerIdx: index("shares_owner_idx").on(table.ownerUserId, table.createdAt),
  releaseIdx: index("shares_release_idx").on(table.fileOwnerUserId, table.releaseId),
  parentIdx: index("shares_parent_idx").on(table.parentShareId),
}));

/** A named recipient of a share (an existing account). `claimedAt` and `hiddenAt` are the recipient's own state, epoch ms. */
export const shareRecipients = sqliteTable("share_recipients", {
  shareId: text("share_id").notNull(),
  userId: text("user_id").notNull(),
  claimedAt: integer("claimed_at"),
  hiddenAt: integer("hidden_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.shareId, table.userId] }),
  userIdx: index("share_recipients_user_idx").on(table.userId, table.createdAt),
}));

/** The public link of a public share; only `sha256(token)` is stored, the token itself never is. */
export const shareLinks = sqliteTable("share_links", {
  shareId: text("share_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => ({
  tokenHashIdx: uniqueIndex("share_links_token_hash_idx").on(table.tokenHash),
}));

/** One download served for a share, for monitoring egress (no caps in the beta). `at` is epoch ms. */
export const shareDownloads = sqliteTable("share_downloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shareId: text("share_id").notNull(),
  name: text("name").notNull(),
  at: integer("at").notNull(),
  via: text("via", { enum: ["recipient", "link"] }).notNull(),
  bytes: integer("bytes").notNull(),
}, (table) => ({
  shareIdx: index("share_downloads_share_idx").on(table.shareId),
  atIdx: index("share_downloads_at_idx").on(table.at),
}));

// Re-exported so callers that only need the `sql` tag for a raw expression
// (e.g. QuotaService's SUM) don't need a second import from drizzle-orm.
export { sql };
