import { DEFAULT_SYNC_BASE_URL, type Settings, type SettingsResponse } from "../../shared/types";

/**
 * Projects the server-internal `Settings` (which carries the sync device
 * token) down to what's safe to send to the browser. Used by every route
 * that returns settings, so the token can never leak by accident.
 */
export function toSettingsResponse(settings: Settings): SettingsResponse {
  const sync = settings.sync;
  return {
    libraryDir: settings.libraryDir,
    sync: {
      baseUrl: sync?.baseUrl ?? DEFAULT_SYNC_BASE_URL,
      email: sync?.email ?? null,
      signedIn: !!sync?.deviceToken,
      lastVersion: sync?.lastVersion ?? 0,
    },
  };
}
