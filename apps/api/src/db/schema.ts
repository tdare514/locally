import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import type { ReleaseRecord } from "../shared/types";

/** 1 GiB, the default free-tier storage limit for a new account. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
  storageLimitBytes: integer("storage_limit_bytes").notNull().default(DEFAULT_STORAGE_LIMIT_BYTES),
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
  platform: text("platform", { enum: ["mac", "ios"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => ({
  tokenHashIdx: uniqueIndex("devices_token_hash_idx").on(table.tokenHash),
  userIdx: index("devices_user_idx").on(table.userId),
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

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  releaseId: text("release_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  bytes: integer("bytes").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => ({
  storageKeyIdx: uniqueIndex("files_storage_key_idx").on(table.storageKey),
  releaseNameIdx: uniqueIndex("files_release_name_idx").on(table.releaseId, table.name),
  userIdx: index("files_user_idx").on(table.userId),
}));

// Re-exported so callers that only need the `sql` tag for a raw expression
// (e.g. QuotaService's SUM) don't need a second import from drizzle-orm.
export { sql };
