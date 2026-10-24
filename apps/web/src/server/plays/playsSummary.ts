import { ValidationError } from "../../shared/errors";
import type { PlaysSummaryAllTime, PlaysSummaryResponse, PlaysSummaryTrack } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import type { SyncApiFactory } from "../sync/SyncEngine";
import { entrySources, totalCount, totalDays, type PlayCounts, type PlayCountStore } from "./PlayCountStore";
import { RETENTION_DAYS, localDay, parseDay } from "./playDays";
import { readServerSummary, type ServerPlaysSummary } from "./serverSummary";

/** Most days one summary request may span, both ends counted (`docs/plans/193-plays-by-day.md`). */
export const MAX_SUMMARY_DAYS = 400;

export interface SummaryRange {
  from: string;
  to: string;
}

/**
 * Checks the `from` and `to` query values: real calendar dates (`2026-02-30` is not one), `from`
 * not after `to`, at most {@link MAX_SUMMARY_DAYS} days, and `to` no later than tomorrow in the
 * Mac's zone (`today` is that zone's date), which leaves room for clock skew. Throws a
 * ValidationError, which the routes answer as a 400.
 */
export function parseSummaryRange(from: string | null, to: string | null, today: string): SummaryRange {
  const fromDay = from === null ? null : parseDay(from);
  const toDay = to === null ? null : parseDay(to);
  const todayDay = parseDay(today);
  if (from === null || to === null || fromDay === null || toDay === null || todayDay === null) {
    throw new ValidationError("from and to must be dates written YYYY-MM-DD");
  }
  if (fromDay > toDay) throw new ValidationError("from must not be after to");
  if (toDay - fromDay + 1 > MAX_SUMMARY_DAYS) {
    throw new ValidationError(`The range can be at most ${MAX_SUMMARY_DAYS} days`);
  }
  if (toDay > todayDay + 1) throw new ValidationError("to must not be after tomorrow");
  // Buckets are kept for RETENTION_DAYS, so an older start could only read days a stale file still holds.
  if (fromDay < todayDay - RETENTION_DAYS) {
    throw new ValidationError(`from must be within the last ${RETENTION_DAYS} days`);
  }
  return { from, to };
}

/**
 * One pass over the store: for each track of a live release, its all-time count, and its plays and
 * last played day among the day buckets inside `from`..`to` (inclusive). `YYYY-MM-DD` strings sort
 * as dates, so the range test is a string compare. Tracks with no plays in the range are left out
 * of `tracks`; tracks of releases that are not in `liveReleaseIds` (deleted, or removed by a sync
 * tombstone without this file hearing of it) are left out of both lists. `countingSince` is the
 * earliest day bucket of those tracks, whatever the range (null when none has a day).
 */
export function buildPlaysSummary(
  counts: PlayCounts,
  liveReleaseIds: ReadonlySet<string>,
  range: SummaryRange,
): PlaysSummaryResponse {
  const tracks: PlaysSummaryTrack[] = [];
  const allTime: PlaysSummaryAllTime[] = [];
  let countingSince: string | null = null;
  for (const trackId in counts.tracks) {
    const entry = counts.tracks[trackId];
    if (!liveReleaseIds.has(entry.releaseId)) continue;
    // The plays of every source added together: the app shows one total per track (#338).
    const total = totalCount(entry);
    if (total > 0) allTime.push({ trackId, releaseId: entry.releaseId, plays: total });
    const days = totalDays(entry);
    if (!days) continue;
    let plays = 0;
    let lastPlayedDay = "";
    for (const day in days) {
      if (countingSince === null || day < countingSince) countingSince = day;
      if (day < range.from || day > range.to) continue;
      plays += days[day];
      if (day > lastPlayedDay) lastPlayedDay = day;
    }
    if (plays > 0) tracks.push({ trackId, releaseId: entry.releaseId, plays, lastPlayedDay });
  }
  return { tracks, allTime, countingSince, includesOtherDevices: false };
}

/**
 * Adds the sync service's summary (every device, this Mac included) to this Mac's own (#202),
 * for releases in `liveReleaseIds` only. For each track:
 * - range plays: `local + max(0, service - thisMacInRange)`, where `thisMacInRange` is what the service
 *   already holds of this Mac's days: the pushed marker for a day, or, for a day with no marker, the
 *   local value while `daysInSync` is false (right after a reset the service may still hold it) and 0
 *   once a pass has run (an unmarked day was never accepted);
 * - `lastPlayedDay`: the later of the two (this Mac's days are a subset of the local ones);
 * - all time: `local + max(0, service - thisMacAllTime)`, `thisMacAllTime` being `pushed` once in sync
 *   and `max(pushed, count)` before.
 * When the service's entry carries `devicePlays` (#216), that is this Mac's share, exact, in place of
 * the marker rule above, for the range and for all time; no markers are read for it.
 * A track only the service reports comes in with the service's values. `countingSince` stays this Mac's.
 */
export function mergeServerSummary(
  local: PlaysSummaryResponse,
  counts: PlayCounts,
  liveReleaseIds: ReadonlySet<string>,
  range: SummaryRange,
  server: ServerPlaysSummary,
): PlaysSummaryResponse {
  const inSync = counts.daysInSync === true;

  const localTracks = new Map(local.tracks.map((t) => [t.trackId, t]));
  const serverTracks = new Map(server.tracks.filter((t) => liveReleaseIds.has(t.releaseId)).map((t) => [t.trackId, t]));
  const tracks: PlaysSummaryTrack[] = [];
  for (const trackId of new Set([...localTracks.keys(), ...serverTracks.keys()])) {
    const mine = localTracks.get(trackId);
    const theirs = serverTracks.get(trackId);
    const entry = counts.tracks[trackId];
    let thisMacInRange = 0;
    if (theirs?.devicePlays !== undefined) {
      thisMacInRange = theirs.devicePlays;
    } else if (entry && theirs) {
      for (const { counts: own } of entrySources(entry)) {
        for (const day in own.days) {
          if (day < range.from || day > range.to) continue;
          thisMacInRange += own.pushedDays?.[day] ?? (inSync ? 0 : own.days[day]);
        }
      }
      // A marker for a day the Mac no longer holds (compacted days go from both) can't be summed above.
    }
    const plays = (mine?.plays ?? 0) + Math.max(0, (theirs?.plays ?? 0) - thisMacInRange);
    if (plays <= 0) continue;
    const lastPlayedDay = [mine?.lastPlayedDay ?? "", theirs?.lastPlayedDay ?? ""].reduce((a, b) => (b > a ? b : a));
    tracks.push({ trackId, releaseId: (mine ?? theirs)!.releaseId, plays, lastPlayedDay });
  }

  const localAll = new Map(local.allTime.map((t) => [t.trackId, t]));
  const serverAll = new Map(server.allTime.filter((t) => liveReleaseIds.has(t.releaseId)).map((t) => [t.trackId, t]));
  const allTime: PlaysSummaryAllTime[] = [];
  for (const trackId of new Set([...localAll.keys(), ...serverAll.keys()])) {
    const mine = localAll.get(trackId);
    const theirs = serverAll.get(trackId);
    const entry = counts.tracks[trackId];
    const thisMacAllTime =
      theirs?.devicePlays !== undefined
        ? theirs.devicePlays
        : entry
          ? entrySources(entry).reduce(
              (sum, { counts: own }) => sum + (inSync ? own.pushed : Math.max(own.pushed, own.count)),
              0,
            )
          : 0;
    const plays = (mine?.plays ?? 0) + Math.max(0, (theirs?.plays ?? 0) - thisMacAllTime);
    if (plays > 0) allTime.push({ trackId, releaseId: (mine ?? theirs)!.releaseId, plays });
  }
  return { tracks, allTime, countingSince: local.countingSince, includesOtherDevices: true };
}

export interface PlaysSummaryDeps {
  settings: Pick<SettingsStore, "get">;
  library: Pick<LibraryRepository, "list">;
  playStore: Pick<PlayCountStore, "get">;
  now: () => number;
  /** When given and the settings hold a device token, the service's summary is merged in (#202). */
  syncApiFactory?: SyncApiFactory;
  /** IANA zone "today" is taken in; the system zone when omitted. */
  timeZone?: string;
}

/**
 * What `GET /api/plays/summary` returns: the range is checked first, then one read of `plays.json`
 * and one of the library index (to know which releases are live). Signed in, the service's summary
 * for other devices is merged in too (#202); signed out, offline or on any failure it is this Mac only.
 */
export async function loadPlaysSummary(
  deps: PlaysSummaryDeps,
  from: string | null,
  to: string | null,
): Promise<PlaysSummaryResponse> {
  const range = parseSummaryRange(from, to, localDay(deps.now(), deps.timeZone));
  const settings = await deps.settings.get();
  const sync = settings.sync;
  // The service's summary is read BEFORE plays.json: a push that lands in between then leaves the
  // markers ahead of the service, which can only undercount other devices, never count this Mac twice.
  const server =
    deps.syncApiFactory && sync?.deviceToken
      ? await readServerSummary(
          deps.syncApiFactory(sync.baseUrl, sync.deviceToken),
          `${sync.baseUrl}|${sync.deviceToken}`,
          range.from,
          range.to,
          deps.now(),
        )
      : null;
  const [counts, releases] = await Promise.all([deps.playStore.get(), deps.library.list(settings.libraryDir)]);
  const liveIds = new Set(releases.map((release) => release.id));
  const local = buildPlaysSummary(counts, liveIds, range);
  return server ? mergeServerSummary(local, counts, liveIds, range, server) : local;
}
