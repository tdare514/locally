import type { Settings } from "../../shared/types";

/**
 * Persists the single mutable piece of app configuration: where the tagged
 * library lives on disk. Behind an interface so tests can substitute an
 * in-memory fake instead of touching the user's real `~/.spotify-local-import`.
 */
export interface SettingsStore {
  /** Read current settings, creating sensible defaults on first run. */
  get(): Promise<Settings>;
  /** Persist new settings and return them back. Prefer {@link update}: a bare set() can write back a stale snapshot. */
  set(settings: Settings): Promise<Settings>;
  /**
   * Read, change and write as one step, one at a time with every other writer in this process.
   * The mutator gets the latest settings and returns the next ones, or null to write nothing.
   * Returns what is stored afterwards. Keep the mutator quick and free of I/O.
   */
  update(mutator: (current: Settings) => Settings | null): Promise<Settings>;
}
