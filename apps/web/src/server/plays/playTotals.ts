import type { PlayTotalsResponse } from "../../shared/types";
import type { PlayCounts } from "./PlayCountStore";

/**
 * This Mac's counts for the tracks of the releases in `liveReleaseIds`, for `GET /api/plays/totals`.
 * A count left behind for a release that is no longer in the library is left out, and so is a count
 * of zero. Pure: it reads only what it is given.
 */
export function localPlayTotals(counts: PlayCounts, liveReleaseIds: ReadonlySet<string>): PlayTotalsResponse {
  const tracks: PlayTotalsResponse["tracks"] = [];
  for (const [trackId, entry] of Object.entries(counts.tracks)) {
    if (entry.count > 0 && liveReleaseIds.has(entry.releaseId)) {
      tracks.push({ releaseId: entry.releaseId, trackId, total: entry.count });
    }
  }
  return { tracks };
}
