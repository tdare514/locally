import type { SyncRecord } from "./SyncRecord";

/** What the files-missing check (#172) has seen of one "From your devices" release. */
export interface MissingMark {
  /** ISO time of the first check that listed this release's files as missing. */
  firstSeenMissingAt: string;
  /** True once a later check listed them as missing again, so they have not arrived: "Waiting". */
  stillMissing: boolean;
  /** ISO time a pull delivered a newer version of this release while it was missing: the phone re-sent it. */
  resentAt?: string;
}

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
  /**
   * releaseId -> sha256 of the cover last uploaded (push) or last applied from remote (pull).
   * `uploadedFiles` alone can't tell a cover replace from a no-op, since the name never changes.
   */
  coverHash: Record<string, string>;
  /** releaseId -> the full remote record, offered in the "From your devices" inbox until accepted. */
  pendingFromPhone: Record<string, SyncRecord>;
  /**
   * releaseId -> the files-missing check's verdict on a pending release (#172). Only releases the
   * latest check listed are here, so a release whose files landed drops out. Empty on an API that
   * has no such check.
   */
  missingFiles: Record<string, MissingMark>;
}

/** Persists {@link SyncState}. Behind an interface so tests use an in-memory fake. */
export interface SyncStateStore {
  get(): Promise<SyncState>;
  set(state: SyncState): Promise<SyncState>;
}

export function emptySyncState(): SyncState {
  return { pushedUpdatedAt: {}, uploadedFiles: {}, coverHash: {}, pendingFromPhone: {}, missingFiles: {} };
}
