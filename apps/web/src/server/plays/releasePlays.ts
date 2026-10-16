import type { ReleasePlaysResponse, TrackPlays, TrackPlaysDevice } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { SyncApiFactory } from "../sync/SyncEngine";
import type { PlayCountEntry, PlayCounts, PlayCountStore } from "./PlayCountStore";
import {
  MAX_PLAY_DAYS_PER_ENTRY,
  MAX_PLAY_DAYS_PER_REQUEST,
  MAX_PLAY_ENTRIES,
  PlayEntrySchema,
  type PlayDay,
  type PlayEntry,
  type ServerReleasePlays,
} from "./playsWire";

/**
 * The days of `entry` whose local value is above what the service accepted (`pushedDays`, a missing
 * day counting as 0), oldest first, each as its absolute value (#202).
 */
function changedDays(entry: PlayCountEntry): PlayDay[] {
  const changed: PlayDay[] = [];
  for (const day of Object.keys(entry.days ?? {}).sort()) {
    const count = entry.days![day];
    if (count > (entry.pushedDays?.[day] ?? 0)) changed.push({ day, count });
  }
  return changed;
}

/**
 * The entries to push: every track whose `count` is above what was last pushed or that has a day
 * above its pushed marker. Each carries its absolute `count` and, when days changed, only those
 * days. A track with more than 400 changed days comes out as several entries (same track, the
 * days split), which {@link batchPlayEntries} puts in different requests. An entry the service would
 * refuse (a hand-edited `plays.json`: an id that isn't a UUID, a count past the cap) is left out, so
 * one bad row can't keep every other count from ever being sent.
 */
export function pendingPlayEntries(counts: PlayCounts): PlayEntry[] {
  const pending: PlayEntry[] = [];
  for (const [trackId, entry] of Object.entries(counts.tracks)) {
    const days = changedDays(entry);
    if (entry.count <= entry.pushed && days.length === 0) continue;
    const chunks: PlayDay[][] = [];
    for (let i = 0; i < days.length; i += MAX_PLAY_DAYS_PER_ENTRY) chunks.push(days.slice(i, i + MAX_PLAY_DAYS_PER_ENTRY));
    if (chunks.length === 0) chunks.push([]);
    for (const chunk of chunks) {
      const parsed = PlayEntrySchema.safeParse({
        releaseId: entry.releaseId,
        trackId,
        count: entry.count,
        ...(chunk.length > 0 ? { days: chunk } : {}),
      });
      if (parsed.success) pending.push(parsed.data);
    }
  }
  return pending;
}

/**
 * Splits entries into requests of at most {@link MAX_PLAY_ENTRIES} entries and
 * {@link MAX_PLAY_DAYS_PER_REQUEST} day rows. An entry goes in the first request with room that does
 * not already hold its track, so the pieces of a split track land in different requests.
 */
export function batchPlayEntries(entries: PlayEntry[]): PlayEntry[][] {
  const batches: { entries: PlayEntry[]; tracks: Set<string>; days: number }[] = [];
  for (const entry of entries) {
    const days = entry.days?.length ?? 0;
    let batch = batches.find(
      (b) =>
        b.entries.length < MAX_PLAY_ENTRIES &&
        b.days + days <= MAX_PLAY_DAYS_PER_REQUEST &&
        !b.tracks.has(entry.trackId),
    );
    if (!batch) {
      batch = { entries: [], tracks: new Set(), days: 0 };
      batches.push(batch);
    }
    batch.entries.push(entry);
    batch.tracks.add(entry.trackId);
    batch.days += days;
  }
  return batches.map((b) => b.entries);
}

const THIS_MAC = "This Mac";

/**
 * The merged view of one release's plays. Other devices come from the service as they are; this
 * Mac is `max(local count, the service's count for this device)`, because the local count can be
 * ahead of the last push and the service's can be ahead after a reinstall; the total is the sum.
 *
 * Signing out revokes this Mac's device row and signing in makes a new one, and the service keeps
 * counting the old row ("revoked devices still count"). That row would show up as another device
 * holding the same plays this Mac has, so any other Mac row with this Mac's device name (the one
 * the sync client sends at sign-in, or the name the service holds for the current row) is folded
 * into this Mac with `max`, never added. A Mac with another name still adds.
 *
 * `server` is null when signed out or the service could not be read: this Mac only. Tracks with
 * no plays are left out.
 */
export function mergeReleasePlays(
  local: PlayCounts,
  releaseId: string,
  server: ServerReleasePlays | null,
  deviceName?: string,
): ReleasePlaysResponse {
  const localByTrack = new Map<string, number>();
  for (const [trackId, entry] of Object.entries(local.tracks)) {
    if (entry.releaseId === releaseId) localByTrack.set(trackId, entry.count);
  }

  const thisMacNames = new Set<string>(deviceName ? [deviceName] : []);
  for (const track of server?.tracks ?? []) {
    for (const device of track.devices) if (device.current) thisMacNames.add(device.name);
  }

  const others = new Map<string, TrackPlaysDevice[]>();
  const serverMine = new Map<string, number>();
  for (const track of server?.tracks ?? []) {
    for (const device of track.devices) {
      if (device.current || (device.platform === "mac" && thisMacNames.has(device.name))) {
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
  /** This Mac's device name, as the sync client sends it when signing in (`os.hostname()`). */
  deviceName: string;
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
  return mergeReleasePlays(local, releaseId, server, deps.deviceName);
}
