import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { authCodes, devices, files, pendingDeletes, releases, userCounters, users } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../shared/errors";
import { emailSchema } from "../../shared/types";

export interface DeleteAccountResult {
  deletedDevices: number;
  deletedReleases: number;
  deletedFiles: number;
  /** The `files.storage_key` values removed, now queued in `pending_deletes`. */
  queuedKeys: string[];
}

/**
 * Deletes a sync account: every row scoped to it (`devices`, `user_counters`,
 * `releases`, `files`, `auth_codes`), plus the `users` row itself, in one
 * transaction — then queues each removed file's storage key in
 * `pending_deletes` so its blob is removed afterward (see
 * `CleanupService.drainPendingDeletes`/`run`). Never deletes a blob inline;
 * see `apps/api/AGENTS.md`.
 */
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Every row delete scoped by `user_id = ?` (or, for `auth_codes`, the matching email), fresh statements for one `db.batch` call. */
  private rowDeleteStatements(userId: string, email: string) {
    return [
      this.db.delete(devices).where(eq(devices.userId, userId)).returning({ id: devices.id }),
      this.db.delete(userCounters).where(eq(userCounters.userId, userId)),
      this.db.delete(releases).where(eq(releases.userId, userId)).returning({ id: releases.id }),
      this.db.delete(files).where(eq(files.userId, userId)).returning({ id: files.id }),
      this.db.delete(authCodes).where(eq(authCodes.email, email)),
      this.db.delete(users).where(eq(users.id, userId)),
    ] as const;
  }

  /**
   * `email` must equal the account's stored email after the same
   * normalisation the auth routes apply (`emailSchema`: trim, lower-case).
   * Throws `NotFoundError` if `userId` doesn't resolve to a user (can't
   * happen behind `requireAuth`, but keeps this service honest on its own)
   * and `ValidationError` on an email mismatch; nothing is deleted in
   * either case.
   */
  async deleteAccount(userId: string, email: string): Promise<DeleteAccountResult> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new NotFoundError("Account not found");
    }

    const normalized = emailSchema.parse(email);
    if (normalized !== user.email) {
      throw new ValidationError("email does not match this account");
    }

    const userFiles = await this.db.select({ storageKey: files.storageKey }).from(files).where(eq(files.userId, userId));
    const now = this.now();

    let deletedDevices: { id: string }[];
    let deletedReleases: { id: string }[];
    let deletedFiles: { id: string }[];

    if (userFiles.length > 0) {
      [deletedDevices, , deletedReleases, deletedFiles] = await this.db.batch([
        ...this.rowDeleteStatements(userId, user.email),
        this.db
          .insert(pendingDeletes)
          .values(userFiles.map((f) => ({ storageKey: f.storageKey, enqueuedAt: now, attempts: 0 })))
          .onConflictDoNothing(),
      ]);
    } else {
      [deletedDevices, , deletedReleases, deletedFiles] = await this.db.batch(this.rowDeleteStatements(userId, user.email));
    }

    return {
      deletedDevices: deletedDevices.length,
      deletedReleases: deletedReleases.length,
      deletedFiles: deletedFiles.length,
      queuedKeys: userFiles.map((f) => f.storageKey),
    };
  }
}
