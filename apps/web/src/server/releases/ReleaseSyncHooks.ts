import type { Release } from "../../shared/types";

/**
 * Notifications `ReleaseService` fires after a successful local mutation, so
 * the sync engine can push the change (or, for a deletion, push a tombstone)
 * without `ReleaseService` needing to know anything about sync, HTTP, or the
 * network. Implementations must never throw back into the caller: failures
 * are the sync engine's problem to record and retry, not the user's action's
 * problem to fail.
 *
 * Wired late via `ReleaseService.setSyncHooks()` rather than through the
 * constructor, because the real implementation (`SyncEngine`) itself depends
 * on `ReleaseService` (to list/get/import/apply releases during reconcile) -
 * constructor injection both ways would be circular. `container.ts` builds
 * `ReleaseService` first (with the default no-op hooks below), then builds
 * `SyncEngine` from it, then wires `SyncEngine` back in as the hooks.
 */
export interface ReleaseSyncHooks {
  onImported(release: Release): void;
  onUpdated(release: Release): void;
  onCoverReplaced(release: Release): void;
  onDeleted(release: Release): void;
}

/** Default hooks used until (or unless) a real sync engine is wired in. */
export class NoopReleaseSyncHooks implements ReleaseSyncHooks {
  onImported(): void {}
  onUpdated(): void {}
  onCoverReplaced(): void {}
  onDeleted(): void {}
}
