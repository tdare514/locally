import type { Db } from "../../db/client";
import { eq, inArray } from "drizzle-orm";
import { authCodes, collections, devices, files, pendingDeletes, playCounts, playDays, releases, shareDownloads, shareLinks, shareRecipients, shares, spotifyLinkRequests, spotifyLinks, userCounters, users } from "../../db/schema";
import { shareTreeIds } from "../shares/tree";
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
 * `releases`, `files`, `shares` (its own and every reshare below them) with their recipients, links and download rows, its `share_recipients` rows, `play_counts`, `play_days`, `spotify_links`, `spotify_link_requests`, `auth_codes`), plus the `users` row itself, in one
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
      this.db.delete(playCounts).where(eq(playCounts.userId, userId)),
      this.db.delete(playDays).where(eq(playDays.userId, userId)),
      this.db.delete(spotifyLinks).where(eq(spotifyLinks.userId, userId)),
      this.db.delete(spotifyLinkRequests).where(eq(spotifyLinkRequests.userId, userId)),
      this.db.delete(collections).where(eq(collections.userId, userId)),
      this.db.delete(authCodes).where(eq(authCodes.email, email)),
      this.db.delete(users).where(eq(users.id, userId)),
    ] as const;
  }

  /**
   * Share rows (#181), fresh statements for the same batch: `shareIds` is the user's own shares and every reshare below them
   * (their recipients, link, download rows and the shares themselves), and the user's recipient rows on other people's shares.
   */
  private shareDeleteStatements(userId: string, shareIds: string[]) {
    return [
      ...(shareIds.length > 0
        ? [
            this.db.delete(shareDownloads).where(inArray(shareDownloads.shareId, shareIds)),
            this.db.delete(shareLinks).where(inArray(shareLinks.shareId, shareIds)),
            this.db.delete(shareRecipients).where(inArray(shareRecipients.shareId, shareIds)),
            this.db.delete(shares).where(inArray(shares.id, shareIds)),
          ]
        : []),
      this.db.delete(shareRecipients).where(eq(shareRecipients.userId, userId)),
    ];
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
    const ownShares = await this.db.select({ id: shares.id }).from(shares).where(eq(shares.ownerUserId, userId));
    const shareIds = await shareTreeIds(this.db, ownShares.map((r) => r.id));
    const shareStatements = this.shareDeleteStatements(userId, shareIds);

    let deletedDevices: { id: string }[];
    let deletedReleases: { id: string }[];
    let deletedFiles: { id: string }[];

    if (userFiles.length > 0) {
      [deletedDevices, , deletedReleases, deletedFiles] = await this.db.batch([
        ...this.rowDeleteStatements(userId, user.email),
        ...shareStatements,
        this.db
          .insert(pendingDeletes)
          .values(userFiles.map((f) => ({ storageKey: f.storageKey, enqueuedAt: now, attempts: 0 })))
          .onConflictDoNothing(),
      ]);
    } else {
      [deletedDevices, , deletedReleases, deletedFiles] = await this.db.batch([...this.rowDeleteStatements(userId, user.email), ...shareStatements]);
    }

    return {
      deletedDevices: deletedDevices.length,
      deletedReleases: deletedReleases.length,
      deletedFiles: deletedFiles.length,
      queuedKeys: userFiles.map((f) => f.storageKey),
    };
  }
}
