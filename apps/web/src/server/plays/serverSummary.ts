import type { SyncApi } from "../sync/SyncApi";
import { SyncRequestError } from "../sync/SyncApi";
import type { ServerPlaysSummaryPage } from "./playsWire";

/** Most pages of the service's summary one read follows (1,000 tracks per page). */
export const MAX_SUMMARY_PAGES = 20;
/** How long a read of the service's summary is reused for the same range. */
export const SUMMARY_CACHE_MS = 60_000;
/** After a 429 or 404 from the summary, the service is not asked again for this long. */
export const SUMMARY_BACKOFF_MS = 10 * 60_000;

export interface ServerPlaysSummary {
  tracks: ServerPlaysSummaryPage["tracks"];
  allTime: ServerPlaysSummaryPage["allTime"];
}

// In memory for the life of the server process. `owner` is the service address and token the data
// was read with, so a sign-out and sign-in (or another account) never reuses it.
let owner = "";
let backoffUntil = 0;
const cache = new Map<string, { at: number; summary: ServerPlaysSummary }>();

/** Test hook: forget the cache and any back-off. */
export function resetServerSummaryState(): void {
  owner = "";
  backoffUntil = 0;
  cache.clear();
}

/**
 * The sync service's summary for `from`..`to`, or null when it can't be had (offline, an error, a
 * back-off). Never throws: the caller shows this Mac's own plays instead. Reads are kept 60 s per
 * range; a 429 or 404 stops further asks for 10 minutes. Only the error message is logged.
 */
export async function readServerSummary(
  api: SyncApi,
  identity: string,
  from: string,
  to: string,
  nowMs: number,
): Promise<ServerPlaysSummary | null> {
  if (identity !== owner) {
    owner = identity;
    backoffUntil = 0;
    cache.clear();
  }
  if (nowMs < backoffUntil) return null;
  const key = `${from}|${to}`;
  const cached = cache.get(key);
  if (cached && nowMs - cached.at < SUMMARY_CACHE_MS) return cached.summary;
  try {
    const summary: ServerPlaysSummary = { tracks: [], allTime: [] };
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SUMMARY_PAGES; page++) {
      const result = await api.playsSummary(from, to, cursor);
      summary.tracks.push(...result.tracks);
      summary.allTime.push(...result.allTime);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    cache.set(key, { at: nowMs, summary });
    return summary;
  } catch (err) {
    if (err instanceof SyncRequestError && (err.status === 429 || err.status === 404)) {
      backoffUntil = nowMs + SUMMARY_BACKOFF_MS;
    }
    console.warn("Play summary: showing this Mac only:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}
