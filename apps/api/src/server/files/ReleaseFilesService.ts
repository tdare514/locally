import crypto from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { files } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../shared/errors";
import type { DownloadTicket, UploadTicket } from "../../shared/types";
import { expectedContentTypeFor } from "./contentTypes";
import type { FileStore } from "./FileStore";
import type { QuotaService } from "../quota/QuotaService";

export interface RegisterFileInput {
  name: string;
  bytes: number;
  contentType: string;
}

/**
 * The server-side storage key for one of a user's release files. Built here
 * — never accepted from the client — so a client can never point storage at
 * another user's or release's path.
 */
export function storageKeyFor(userId: string, releaseId: string, name: string): string {
  return `users/${userId}/releases/${releaseId}/${name}`;
}

/**
 * Bridges the `files` DB table (bookkeeping: name, size, content type,
 * storage key — used by `QuotaService`) and the `FileStore` (the actual
 * object storage). Re-registering an existing `(releaseId, name)` replaces
 * its row, since track file names never change across edits (see
 * `spec/sync.md`); only the *net* new bytes count against quota.
 */
export class ReleaseFilesService {
  constructor(
    private readonly db: Db,
    private readonly fileStore: FileStore,
    private readonly quota: QuotaService,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Throws `ValidationError` if any input's declared `contentType` doesn't
   * match the one both clients derive from its extension (see
   * `contentTypes.ts`) — a client can't claim `cover.jpg` is `text/html`.
   */
  private assertContentTypes(inputs: RegisterFileInput[]): void {
    for (const input of inputs) {
      const expected = expectedContentTypeFor(input.name);
      if (input.contentType !== expected) {
        throw new ValidationError(`${input.name} must have content type ${expected ?? "matching its extension"}`);
      }
    }
  }

  /** Issue upload URLs for one or more files, enforcing the per-file cap and the account quota. */
  async createUploads(userId: string, releaseId: string, inputs: RegisterFileInput[]): Promise<UploadTicket[]> {
    this.assertContentTypes(inputs);
    this.quota.assertFileSizes(inputs.map((f) => f.bytes));

    const requestedTotal = inputs.reduce((sum, f) => sum + f.bytes, 0);
    const prepared = inputs.map((input) => ({ input, key: storageKeyFor(userId, releaseId, input.name) }));

    // The quota check and the row upserts are ONE statement (#28: a write's
    // preconditions are repeated inside the write), so two concurrent requests
    // cannot both pass the check against the same usage. Usage, replaced bytes
    // and the limit are all read inside the statement, never in a prior query.
    // No network work happens before it succeeds: tickets are issued after. If
    // that fails, the rows count bytes for a ticket never issued, the same as
    // any abandoned upload today; nothing reclaims those yet (#89).
    if (prepared.length > 0) {
      const now = this.now();
      const rows = sql.join(
        prepared.map(
          ({ input, key }) =>
            sql`(${crypto.randomUUID()}, ${releaseId}, ${userId}, ${input.name}, ${input.bytes}, ${input.contentType}, ${key}, ${now})`
        ),
        sql`, `
      );
      const names = sql.join(
        prepared.map(({ input }) => sql`${input.name}`),
        sql`, `
      );
      const replaced = sql`COALESCE((SELECT SUM(bytes) FROM files WHERE user_id = ${userId} AND release_id = ${releaseId} AND name IN (${names})), 0)`;
      const used = sql`COALESCE((SELECT SUM(bytes) FROM files WHERE user_id = ${userId}), 0)`;
      const limit = sql`(SELECT storage_limit_bytes FROM users WHERE id = ${userId})`;
      const result = await this.db.run(sql`
        INSERT INTO files (id, release_id, user_id, name, bytes, content_type, storage_key, created_at)
        SELECT column1, column2, column3, column4, column5, column6, column7, column8
        FROM (VALUES ${rows})
        WHERE ${requestedTotal} - ${replaced} <= 0
           OR ${used} + ${requestedTotal} - ${replaced} <= ${limit}
        ON CONFLICT (release_id, name) DO UPDATE SET
          bytes = excluded.bytes,
          content_type = excluded.content_type,
          storage_key = excluded.storage_key,
          created_at = excluded.created_at
      `);
      if (result.rowsAffected === 0) {
        // Rejected by the guard. Re-run the plain check for the precise error
        // (a missing user is a 404); otherwise it is the quota.
        await this.quota.assertWithinQuota(userId, requestedTotal);
        throw new ValidationError("Storage quota exceeded");
      }
    }

    const tickets: UploadTicket[] = [];
    for (const { input, key } of prepared) {
      const ticket = await this.fileStore.createUpload({ key, bytes: input.bytes, contentType: input.contentType });
      tickets.push({ name: input.name, url: ticket.url, method: ticket.method, headers: ticket.headers });
    }
    return tickets;
  }

  /** A short-lived download URL for a release's file, scoped to `userId`. */
  async createDownload(userId: string, releaseId: string, name: string): Promise<DownloadTicket> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.releaseId, releaseId), eq(files.userId, userId), eq(files.name, name)));
    if (!row) {
      throw new NotFoundError("File not found");
    }
    return this.fileStore.createDownload(row.storageKey);
  }

  /**
   * Delete every registered file for `releaseId` whose name isn't in
   * `keepNames` — called after a release update so a track/cover a client
   * dropped from the record doesn't linger in storage or against quota.
   * Drizzle's `notInArray` rejects an empty array, so an empty `keepNames`
   * (a release with no files left to keep) instead selects every row for
   * the release. Blobs go in one `deleteMany`; DB rows in one
   * `WHERE id IN (...)`. Returns the number of files pruned. Tombstoned
   * releases are handled separately, by `CleanupService`. The PUT route
   * runs this after the response (#31), so failures here must be logged by
   * the caller, never turned into a 500.
   */
  async pruneUnreferenced(userId: string, releaseId: string, keepNames: string[]): Promise<number> {
    const scoped = and(eq(files.userId, userId), eq(files.releaseId, releaseId));
    const condition = keepNames.length > 0 ? and(scoped, notInArray(files.name, keepNames)) : scoped;

    const rows = await this.db.select().from(files).where(condition);
    if (rows.length === 0) return 0;

    await this.fileStore.deleteMany(rows.map((row) => row.storageKey));
    await this.db.delete(files).where(
      inArray(
        files.id,
        rows.map((row) => row.id)
      )
    );
    return rows.length;
  }
}
