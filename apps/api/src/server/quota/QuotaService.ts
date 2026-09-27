import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { files, users } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../shared/errors";

/** Per-file cap, independent of the account's overall quota. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Storage accounting: how many bytes a user's files currently occupy versus
 * their account limit. There's no separate "bytes used" counter column —
 * usage is always the live `SUM(files.bytes)`, so it can never drift from
 * what's actually stored.
 */
export class QuotaService {
  constructor(private readonly db: Db) {}

  async usedBytes(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${files.bytes}), 0)` })
      .from(files)
      .where(eq(files.userId, userId));
    return row?.total ?? 0;
  }

  async limitBytes(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ limit: users.storageLimitBytes })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) {
      throw new NotFoundError("User not found");
    }
    return row.limit;
  }

  /** Throws `ValidationError` if any file exceeds the per-file cap. */
  assertFileSizes(sizesInBytes: readonly number[]): void {
    for (const bytes of sizesInBytes) {
      if (bytes > MAX_FILE_BYTES) {
        throw new ValidationError(`File is larger than the ${MAX_FILE_BYTES / (1024 * 1024)}MB per-file limit`);
      }
    }
  }

  /** Throws `ValidationError` if adding `additionalBytes` would exceed the account's quota. */
  async assertWithinQuota(userId: string, additionalBytes: number): Promise<void> {
    const [used, limit] = await Promise.all([this.usedBytes(userId), this.limitBytes(userId)]);
    if (used + additionalBytes > limit) {
      throw new ValidationError("Storage quota exceeded");
    }
  }
}
