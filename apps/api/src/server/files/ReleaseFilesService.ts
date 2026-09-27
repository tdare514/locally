import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { files } from "../../db/schema";
import { NotFoundError } from "../../shared/errors";
import type { DownloadTicket, UploadTicket } from "../../shared/types";
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

  private async existingBytesFor(userId: string, releaseId: string, names: string[]): Promise<number> {
    if (names.length === 0) return 0;
    const rows = await this.db
      .select({ bytes: files.bytes })
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.releaseId, releaseId), inArray(files.name, names)));
    return rows.reduce((sum, row) => sum + row.bytes, 0);
  }

  /** Issue upload URLs for one or more files, enforcing the per-file cap and the account quota. */
  async createUploads(userId: string, releaseId: string, inputs: RegisterFileInput[]): Promise<UploadTicket[]> {
    this.quota.assertFileSizes(inputs.map((f) => f.bytes));

    const requestedTotal = inputs.reduce((sum, f) => sum + f.bytes, 0);
    const replacedTotal = await this.existingBytesFor(
      userId,
      releaseId,
      inputs.map((f) => f.name)
    );
    const netAdditionalBytes = requestedTotal - replacedTotal;
    if (netAdditionalBytes > 0) {
      await this.quota.assertWithinQuota(userId, netAdditionalBytes);
    }

    const tickets: UploadTicket[] = [];
    for (const input of inputs) {
      const key = storageKeyFor(userId, releaseId, input.name);
      const ticket = await this.fileStore.createUpload({ key, bytes: input.bytes, contentType: input.contentType });

      await this.db
        .insert(files)
        .values({
          id: crypto.randomUUID(),
          releaseId,
          userId,
          name: input.name,
          bytes: input.bytes,
          contentType: input.contentType,
          storageKey: key,
          createdAt: this.now(),
        })
        .onConflictDoUpdate({
          target: [files.releaseId, files.name],
          set: { bytes: input.bytes, contentType: input.contentType, storageKey: key, createdAt: this.now() },
        });

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
}
