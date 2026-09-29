import path from "node:path";
import type { Settings } from "../../shared/types";
import type { ParsedSettingsPut } from "../http/validation";
import { applySyncBaseUrlChange } from "../sync/settings";

export type SettingsUpdateResult =
  | {
      ok: true;
      settings: Settings;
      /** True when the sync host changed: local sync bookkeeping must be reset before saving. */
      resetSyncState: boolean;
    }
  | { ok: false; error: string };

/**
 * Policy for PUT /api/settings: decides the next settings from the current ones and the
 * validated request, and says which side effects the caller must perform. Pure apart from
 * the injected `homeDir`, so it never reads the real home directory itself.
 */
export function planSettingsUpdate(
  current: Settings,
  body: ParsedSettingsPut,
  homeDir: string
): SettingsUpdateResult {
  let libraryDir = current.libraryDir;
  let spotifySourceDismissed = current.spotifySourceDismissed;
  if (body.libraryDir !== undefined) {
    let dir = body.libraryDir;
    if (dir === "~" || dir.startsWith("~/")) dir = path.join(homeDir, dir.slice(1));
    if (!path.isAbsolute(dir)) {
      return {
        ok: false,
        error: "libraryDir must be an absolute path (e.g. /Users/you/Music/Spotify Local Import)",
      };
    }
    dir = path.resolve(dir);
    if (dir === path.parse(dir).root || dir === homeDir) {
      return {
        ok: false,
        error: "libraryDir must be a dedicated folder, not your home folder or the filesystem root",
      };
    }
    // A new folder needs to be added to Spotify again, so the one-time
    // prompt should reappear.
    if (dir !== current.libraryDir) spotifySourceDismissed = false;
    libraryDir = dir;
  }

  let sync = current.sync;
  let resetSyncState = false;
  if (body.sync?.baseUrl !== undefined) {
    const result = applySyncBaseUrlChange(current.sync, body.sync.baseUrl);
    if (!result.ok) return { ok: false, error: result.error };
    sync = result.sync;
    // `applySyncBaseUrlChange` returns a fresh object when the host changed
    // (or there was no previous sync config) and the same `current.sync`
    // object when the URL is unchanged. Local sync bookkeeping — pushed
    // versions, uploaded files, cover hashes, pending phone releases — was
    // built against the old host's device token, so it must be reset along
    // with it; otherwise it's misread as already-synced against the new host.
    resetSyncState = sync !== current.sync;
  }

  if (body.libraryDir === undefined && body.sync?.baseUrl === undefined) {
    return { ok: false, error: "Nothing to update: pass libraryDir and/or sync.baseUrl" };
  }

  return { ok: true, settings: { ...current, libraryDir, sync, spotifySourceDismissed }, resetSyncState };
}
