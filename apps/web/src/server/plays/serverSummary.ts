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

/** Most summary page requests per rolling hour, per identity: the service allows 600 an hour per user, so the rest is left to the user's other devices. */
export const SUMMARY_PAGE_BUDGET = 200;
const HOUR_MS = 60 * 60_000;

interface IdentityState {
  backoffUntil: number;
  cache: Map<string, { at: number; summary: ServerPlaysSummary }>;
  inflight: Map<string, Promise<ServerPlaysSummary | null>>;
  /** When each page request was made, for the rolling-hour budget. */
  requests: number[];
}

// In memory for the life of the server process. The state belongs to one identity (the service
// address and token it was read with); a different identity swaps in a fresh one, and a read that
// started under the old one only ever writes to the old, now unreachable, state.
let current: { identity: string; state: IdentityState } | null = null;
// Bumped by `invalidateServerSummary`: a read that began before a bump is not cached.
let generation = 0;

function stateFor(identity: string): IdentityState {
  if (!current || current.identity !== identity) {
    current = { identity, state: { backoffUntil: 0, cache: new Map(), inflight: new Map(), requests: [] } };
  }
  return current.state;
}

/** Test hook: forget the cache, in-flight reads, back-off and budget. */
export function resetServerSummaryState(): void {
  current = null;
  generation++;
}

/**
 * Drops every cached range, for every identity, and stops in-flight reads from being cached: call it
 * after a push is marked, so a summary read before the push is never merged with markers read after
 * it (that would count this Mac twice).
 *
 * Remaining rare case: a push the service accepted whose marker write then fails is counted twice
 * until the next reconcile re-sends and marks it. An exact fix needs the service to report the
 * calling device's own share (#216).
 */
export function invalidateServerSummary(): void {
  generation++;
  if (current) {
    current.state.cache.clear();
    current.state.inflight.clear();
  }
}

/**
 * The sync service's summary for `from`..`to`, or null when it can't be had (offline, an error, a
 * back-off, the hourly page budget). Never throws: the caller shows this Mac's own plays instead.
 * Reads are kept 60 s per range and shared while in flight; a 429 or 404 stops further asks (other
 * loops included, checked before every page) for 10 minutes. Only the error message is logged.
 */
export async function readServerSummary(
  api: SyncApi,
  identity: string,
  from: string,
  to: string,
  nowMs: number,
): Promise<ServerPlaysSummary | null> {
  const state = stateFor(identity);
  if (nowMs < state.backoffUntil) return null;
  const key = `${from}|${to}`;
  const cached = state.cache.get(key);
  if (cached && nowMs - cached.at < SUMMARY_CACHE_MS) return cached.summary;
  const shared = state.inflight.get(key);
  if (shared) return shared;

  const startedAt = generation;
  const read = fetchPages(api, state, from, to, nowMs)
    .then((summary) => {
      if (summary && startedAt === generation) state.cache.set(key, { at: nowMs, summary });
      return summary;
    })
    .finally(() => {
      if (state.inflight.get(key) === read) state.inflight.delete(key);
    });
  state.inflight.set(key, read);
  return read;
}

async function fetchPages(
  api: SyncApi,
  state: IdentityState,
  from: string,
  to: string,
  nowMs: number,
): Promise<ServerPlaysSummary | null> {
  try {
    const summary: ServerPlaysSummary = { tracks: [], allTime: [] };
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SUMMARY_PAGES; page++) {
      if (nowMs < state.backoffUntil) return null;
      state.requests = state.requests.filter((at) => nowMs - at < HOUR_MS);
      if (state.requests.length >= SUMMARY_PAGE_BUDGET) return null;
      state.requests.push(nowMs);
      const result = await api.playsSummary(from, to, cursor);
      summary.tracks.push(...result.tracks);
      summary.allTime.push(...result.allTime);
      if (!result.nextCursor) return summary;
      cursor = result.nextCursor;
    }
    // Pages still pending after the guard: a partial summary would silently drop other devices'
    // plays for the tracks beyond it, so show this Mac only instead.
    console.warn(`Play summary: more than ${MAX_SUMMARY_PAGES} pages; showing this Mac only`);
    return null;
  } catch (err) {
    if (err instanceof SyncRequestError && (err.status === 429 || err.status === 404)) {
      state.backoffUntil = nowMs + SUMMARY_BACKOFF_MS;
    }
    console.warn("Play summary: showing this Mac only:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}
