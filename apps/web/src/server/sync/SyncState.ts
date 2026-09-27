import type { SyncRecord } from "./SyncRecord";

/**
 * Local sync bookkeeping, separate from `Settings` because none of it is a
 * secret and all of it is safe to rebuild from scratch (worst case: a few
 * redundant re-uploads or re-offered phone releases, never data loss).
 */
export interface SyncState {
  /** releaseId -> the local `updatedAt` value that was last successfully pushed (or matched from a pull). */
  pushedUpdatedAt: Record<string, string>;
  /** releaseId -> file names already known to exist in remote storage, so pushes don't re-upload them. */
  uploadedFiles: Record<string, string[]>;
  /** releaseId -> the full remote record, offered in the "From your phone" inbox until accepted. */
  pendingFromPhone: Record<string, SyncRecord>;
}

/** Persists {@link SyncState}. Behind an interface so tests use an in-memory fake. */
export interface SyncStateStore {
  get(): Promise<SyncState>;
  set(state: SyncState): Promise<SyncState>;
}

export function emptySyncState(): SyncState {
  return { pushedUpdatedAt: {}, uploadedFiles: {}, pendingFromPhone: {} };
}
