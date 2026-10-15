import { ValidationError } from "../../shared/errors";
import type { PlaysSummaryAllTime, PlaysSummaryResponse, PlaysSummaryTrack } from "../../shared/types";
import type { SettingsStore } from "../config/SettingsStore";
import type { LibraryRepository } from "../storage/LibraryRepository";
import type { PlayCounts, PlayCountStore } from "./PlayCountStore";
import { localDay, parseDay } from "./playDays";

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
  return { from, to };
}

/**
 * One pass over the store: for each track of a live release, its all-time count, and its plays and
 * last played day among the day buckets inside `from`..`to` (inclusive). `YYYY-MM-DD` strings sort
 * as dates, so the range test is a string compare. Tracks with no plays in the range are left out
 * of `tracks`; tracks of releases that are not in `liveReleaseIds` (deleted, or removed by a sync
 * tombstone without this file hearing of it) are left out of both lists.
 */
export function buildPlaysSummary(
  counts: PlayCounts,
  liveReleaseIds: ReadonlySet<string>,
  range: SummaryRange,
): PlaysSummaryResponse {
  const tracks: PlaysSummaryTrack[] = [];
  const allTime: PlaysSummaryAllTime[] = [];
  for (const trackId in counts.tracks) {
    const entry = counts.tracks[trackId];
    if (!liveReleaseIds.has(entry.releaseId)) continue;
    if (entry.count > 0) allTime.push({ trackId, releaseId: entry.releaseId, plays: entry.count });
    const days = entry.days;
    if (!days) continue;
    let plays = 0;
    let lastPlayedDay = "";
    for (const day in days) {
      if (day < range.from || day > range.to) continue;
      plays += days[day];
      if (day > lastPlayedDay) lastPlayedDay = day;
    }
    if (plays > 0) tracks.push({ trackId, releaseId: entry.releaseId, plays, lastPlayedDay });
  }
  return { tracks, allTime };
}

export interface PlaysSummaryDeps {
  settings: Pick<SettingsStore, "get">;
  library: Pick<LibraryRepository, "list">;
  playStore: Pick<PlayCountStore, "get">;
  now: () => number;
  /** IANA zone "today" is taken in; the system zone when omitted. */
  timeZone?: string;
}

/**
 * What `GET /api/plays/summary` returns: the range is checked first, then one read of `plays.json`
 * and one of the library index (to know which releases are live). Local only: no sync service call.
 */
export async function loadPlaysSummary(
  deps: PlaysSummaryDeps,
  from: string | null,
  to: string | null,
): Promise<PlaysSummaryResponse> {
  const range = parseSummaryRange(from, to, localDay(deps.now(), deps.timeZone));
  const settings = await deps.settings.get();
  const [counts, releases] = await Promise.all([deps.playStore.get(), deps.library.list(settings.libraryDir)]);
  return buildPlaysSummary(counts, new Set(releases.map((release) => release.id)), range);
}
