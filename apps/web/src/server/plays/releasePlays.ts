import type { ReleasePlaysResponse, TrackPlays, TrackPlaysDevice } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { SyncApiFactory } from "../sync/SyncEngine";
import type { PlayCounts, PlayCountStore } from "./PlayCountStore";
import { MAX_PLAY_ENTRIES, PlayEntrySchema, type PlayEntry, type ServerReleasePlays } from "./playsWire";

/**
 * The entries to push: every track whose `count` is above what was last pushed. An entry the
 * service would refuse (a hand-edited `plays.json`: an id that isn't a UUID, a count past the cap)
 * is left out, so one bad row can't keep every other count from ever being sent.
 */
export function pendingPlayEntries(counts: PlayCounts): PlayEntry[] {
  const pending: PlayEntry[] = [];
  for (const [trackId, entry] of Object.entries(counts.tracks)) {
    if (entry.count <= entry.pushed) continue;
    const parsed = PlayEntrySchema.safeParse({ releaseId: entry.releaseId, trackId, count: entry.count });
    if (parsed.success) pending.push(parsed.data);
  }
  return pending;
}

/** Splits entries into requests of at most {@link MAX_PLAY_ENTRIES}. */
export function batchPlayEntries(entries: PlayEntry[]): PlayEntry[][] {
  const batches: PlayEntry[][] = [];
  for (let i = 0; i < entries.length; i += MAX_PLAY_ENTRIES) {
    batches.push(entries.slice(i, i + MAX_PLAY_ENTRIES));
  }
  return batches;
}

const THIS_MAC = "This Mac";

/**
 * The merged view of one release's plays. Other devices come from the service as they are; this
 * Mac is `max(local count, the service's count for this device)`, because the local count can be
 * ahead of the last push and the service's can be ahead after a reinstall; the total is the sum.
 * `server` is null when signed out or the service could not be read: this Mac only. Tracks with
 * no plays are left out.
 */
export function mergeReleasePlays(
  local: PlayCounts,
  releaseId: string,
  server: ServerReleasePlays | null,
): ReleasePlaysResponse {
  const localByTrack = new Map<string, number>();
  for (const [trackId, entry] of Object.entries(local.tracks)) {
    if (entry.releaseId === releaseId) localByTrack.set(trackId, entry.count);
  }

  const others = new Map<string, TrackPlaysDevice[]>();
  const serverMine = new Map<string, number>();
  for (const track of server?.tracks ?? []) {
    for (const device of track.devices) {
      if (device.current) {
        serverMine.set(track.trackId, Math.max(serverMine.get(track.trackId) ?? 0, device.count));
      } else {
        const list = others.get(track.trackId) ?? [];
        list.push({ name: device.name, platform: device.platform, count: device.count, current: false });
        others.set(track.trackId, list);
      }
    }
  }

  const trackIds = new Set([...localByTrack.keys(), ...serverMine.keys(), ...others.keys()]);
  const tracks: TrackPlays[] = [];
  for (const trackId of trackIds) {
    const mine = Math.max(localByTrack.get(trackId) ?? 0, serverMine.get(trackId) ?? 0);
    const devices = [
      ...(others.get(trackId) ?? []),
      { name: THIS_MAC, platform: "mac", count: mine, current: true },
    ].filter((d) => d.count > 0);
    const total = devices.reduce((sum, d) => sum + d.count, 0);
    if (total > 0) tracks.push({ trackId, total, devices });
  }
  return { tracks };
}

export interface ReleasePlaysDeps {
  settings: SettingsStore;
  playStore: PlayCountStore;
  syncApiFactory: SyncApiFactory;
}

/**
 * What `GET /api/plays` returns: one read of `plays.json`, plus one request to the sync service
 * when signed in. A failed or slow service call (offline, 404 for a release not pushed yet, 5xx)
 * falls back to this Mac's own counts instead of failing the page. Only the error message is
 * logged, never the token.
 */
export async function loadReleasePlays(deps: ReleasePlaysDeps, releaseId: string): Promise<ReleasePlaysResponse> {
  const [local, settings] = await Promise.all([deps.playStore.get(), deps.settings.get()]);
  let server: ServerReleasePlays | null = null;
  if (settings.sync?.deviceToken) {
    try {
      server = await deps.syncApiFactory(settings.sync.baseUrl, settings.sync.deviceToken).releasePlays(releaseId);
    } catch (err) {
      console.warn("Play counts: showing this Mac only:", err instanceof Error ? err.message : "unknown error");
    }
  }
  return mergeReleasePlays(local, releaseId, server);
}
