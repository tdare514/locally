import type { Release } from "../../shared/types";

/**
 * Persists the release index for a library directory. Every method is scoped
 * to a `libraryDir` (rather than fixed at construction) because the user can
 * repoint the app at a different folder at any time via `/api/settings`.
 *
 * Kept behind an interface so the JSON-file implementation can later be
 * swapped for e.g. SQLite without touching `ReleaseService` (see
 * `docs/adr/0002-json-index-behind-repository-interface.md`).
 */
export interface LibraryRepository {
  /** All releases currently indexed for this library. */
  list(libraryDir: string): Promise<Release[]>;
  /** Find one release by id, or null if not indexed. */
  find(libraryDir: string, id: string): Promise<Release | null>;
  /** Insert or replace a release by id. Returns the stored release. */
  upsert(libraryDir: string, release: Release): Promise<Release>;
  /** Remove a release by id. Returns the removed release, or null if not found. */
  remove(libraryDir: string, id: string): Promise<Release | null>;
}
