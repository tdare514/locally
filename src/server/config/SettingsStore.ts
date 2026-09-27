import type { Settings } from "../../shared/types";

/**
 * Persists the single mutable piece of app configuration: where the tagged
 * library lives on disk. Behind an interface so tests can substitute an
 * in-memory fake instead of touching the user's real `~/.spotify-local-import`.
 */
export interface SettingsStore {
  /** Read current settings, creating sensible defaults on first run. */
  get(): Promise<Settings>;
  /** Persist new settings and return them back. */
  set(settings: Settings): Promise<Settings>;
}
