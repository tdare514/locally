import { ValidationError } from "../../shared/errors";
import type { PlaysSummaryAllTime, PlaysSummaryResponse, PlaysSummaryTrack } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import type { SyncApiFactory } from "../sync/SyncEngine";
import { isPendingEvent, type PlayEvent, type PlayEventStore } from "./PlayEventStore";
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

/** The play-event fields of one track (#398). */
interface EventTotals {
  lastPlayedAt: number;
  listenedMs: number;
  events: number;
}

/**
 * Per track, the latest start, the audible ms and the count of the events passing `inWindow`, for live releases.
 * With `pendingOnly` the ms and count are only what the sync service has not been sent (an event pushed in full
 * adds nothing; one raised since adds the difference), because the service's own summary already holds the rest;
 * `lastPlayedAt` always takes every event.
 */
function eventTotals(
  events: readonly PlayEvent[],
  live: ReadonlySet<string>,
  inWindow: (event: PlayEvent) => boolean,
  pendingOnly: boolean,
): Map<string, EventTotals> {
  const totals = new Map<string, EventTotals>();
  for (const event of events) {
    if (!live.has(event.releaseId) || !inWindow(event)) continue;
    const total = totals.get(event.trackId) ?? { lastPlayedAt: 0, listenedMs: 0, events: 0 };
    total.lastPlayedAt = Math.max(total.lastPlayedAt, event.startedAt);
    if (!pendingOnly) {
      total.listenedMs += event.listenedMs;
      total.events += 1;
    } else if (isPendingEvent(event)) {
      total.listenedMs += event.listenedMs - (event.pushedListenedMs ?? 0);
      if (event.pushedListenedMs === null) total.events += 1;
    }
    totals.set(event.trackId, total);
  }
  return totals;
}

/** The service's event fields and this Mac's added together: the latest start, the sum of ms and of events. */
function combineEvents(
  mine: Partial<EventTotals> | undefined,
  theirs: { lastPlayedAt?: number | null; listenedMs?: number; events?: number } | undefined,
): { lastPlayedAt?: number | null; listenedMs?: number; events?: number } {
  const lastPlayedAt = Math.max(mine?.lastPlayedAt ?? 0, theirs?.lastPlayedAt ?? 0);
  const listenedMs = (mine?.listenedMs ?? 0) + (theirs?.listenedMs ?? 0);
  const events = (mine?.events ?? 0) + (theirs?.events ?? 0);
  if (!mine && theirs?.events === undefined && theirs?.listenedMs === undefined && theirs?.lastPlayedAt === undefined) return {};
  return { lastPlayedAt: lastPlayedAt > 0 ? lastPlayedAt : null, listenedMs, events };
}

function withEvents<T extends object>(base: T, totals: Partial<EventTotals> | undefined): T {
  return totals ? { ...base, lastPlayedAt: totals.lastPlayedAt ?? null, listenedMs: totals.listenedMs ?? 0, events: totals.events ?? 0 } : base;
}

/**
 * One pass over the store: for each track of a live release, its all-time count, and its plays and
 * last played day among the day buckets inside `from`..`to` (inclusive). `YYYY-MM-DD` strings sort
 * as dates, so the range test is a string compare. Tracks with no plays in the range are left out
 * of `tracks`; tracks of releases that are not in `liveReleaseIds` (deleted, or removed by a sync
 * tombstone without this file hearing of it) are left out of both lists. `countingSince` is the
 * earliest day bucket of those tracks, whatever the range (null when none has a day).
 * `events` (#398) add `lastPlayedAt`, `listenedMs` and `events` to the tracks that have some; an event is in a
 * range by its `day`.
 */
export function buildPlaysSummary(
  counts: PlayCounts,
  liveReleaseIds: ReadonlySet<string>,
  range: SummaryRange,
  events: readonly PlayEvent[] = [],
): PlaysSummaryResponse {
  const inRange = eventTotals(events, liveReleaseIds, (e) => e.day >= range.from && e.day <= range.to, false);
  const everything = eventTotals(events, liveReleaseIds, () => true, false);
  const tracks: PlaysSummaryTrack[] = [];
  const allTime: PlaysSummaryAllTime[] = [];
  let countingSince: string | null = null;
  for (const trackId in counts.tracks) {
    const entry = counts.tracks[trackId];
    if (!liveReleaseIds.has(entry.releaseId)) continue;
    // The plays of every source added together: the app shows one total per track (#338).
    const total = totalCount(entry);
    if (total > 0) allTime.push(withEvents({ trackId, releaseId: entry.releaseId, plays: total }, everything.get(trackId)));
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
    if (plays > 0) tracks.push(withEvents({ trackId, releaseId: entry.releaseId, plays, lastPlayedDay }, inRange.get(trackId)));
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
 * Play events (#398): the service's summary already holds the events this Mac has pushed, so only the ones it has
 * not been sent (and the audible time added since) are added to the service's: `lastPlayedAt` is the later of the
 * two, `listenedMs` and `events` the sums.
 */
export function mergeServerSummary(
  local: PlaysSummaryResponse,
  counts: PlayCounts,
  liveReleaseIds: ReadonlySet<string>,
  range: SummaryRange,
  server: ServerPlaysSummary,
  events: readonly PlayEvent[] = [],
): PlaysSummaryResponse {
  const inSync = counts.daysInSync === true;
  const pendingInRange = eventTotals(events, liveReleaseIds, (e) => e.day >= range.from && e.day <= range.to, true);
  const pendingAll = eventTotals(events, liveReleaseIds, () => true, true);

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
    tracks.push({ trackId, releaseId: (mine ?? theirs)!.releaseId, plays, lastPlayedDay, ...combineEvents(pendingInRange.get(trackId), theirs) });
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
    if (plays > 0) allTime.push({ trackId, releaseId: (mine ?? theirs)!.releaseId, plays, ...combineEvents(pendingAll.get(trackId), theirs) });
  }
  return { tracks, allTime, countingSince: local.countingSince, includesOtherDevices: true };
}

export interface PlaysSummaryDeps {
  settings: Pick<SettingsStore, "get">;
  library: Pick<LibraryRepository, "list">;
  playStore: Pick<PlayCountStore, "get">;
  /** This Mac's play events (#398); omitted, the summary carries no event fields of its own. */
  playEvents?: Pick<PlayEventStore, "list">;
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
  const [counts, releases, events] = await Promise.all([
    deps.playStore.get(),
    deps.library.list(settings.libraryDir),
    deps.playEvents ? deps.playEvents.list().catch(() => []) : Promise.resolve([]),
  ]);
  const liveIds = new Set(releases.map((release) => release.id));
  const local = buildPlaysSummary(counts, liveIds, range, events);
  return server ? mergeServerSummary(local, counts, liveIds, range, server, events) : local;
}
