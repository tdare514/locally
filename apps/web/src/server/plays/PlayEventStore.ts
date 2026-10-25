import type { PlaySource } from "./PlayCountStore";

/** Most audible ms one event may hold: a day (`spec/sync.md`, "Play events"). */
export const MAX_EVENT_LISTENED_MS = 86_400_000;
/** Most events kept on this Mac; the oldest pushed ones go first. */
export const MAX_PLAY_EVENTS = 20_000;
/** Most events in one `PUT /v1/plays/events` body. */
export const MAX_PLAY_EVENTS_PER_PUSH = 500;

/** One counted play: when its session began, how long it was heard, and what the sync service has been sent (#398). */
export interface PlayEvent {
  id: string;
  releaseId: string;
  trackId: string;
  source: PlaySource;
  /** Epoch ms when the play's session began. */
  startedAt: number;
  /** The Mac's local `YYYY-MM-DD` of `startedAt`. */
  day: string;
  /** Audible ms of the session so far; only grows. */
  listenedMs: number;
  /** The `listenedMs` the sync service accepted; null until the first push. */
  pushedListenedMs: number | null;
  /** Whether the play's count has been added to `plays.json`. Local only: never sent (`PlayEventWire` leaves it out). */
  counted: boolean;
}

/** What a client reports for one session; `record` makes it an event or raises an existing one. */
export interface PlayEventInput {
  releaseId: string;
  trackId: string;
  source: PlaySource;
  startedAt: number;
  listenedMs: number;
  /** True when the caller has already counted this play (the Spotify tracker); false (the default) leaves the count to `markCounted`. */
  counted?: boolean;
}

/** An event whose latest `listenedMs` has not reached the sync service. */
export function isPendingEvent(event: PlayEvent): boolean {
  return event.pushedListenedMs === null || event.pushedListenedMs < event.listenedMs;
}

/** Persists the play events counted on this Mac. */
export interface PlayEventStore {
  list(): Promise<PlayEvent[]>;
  /**
   * One event per session, keyed by (source, trackId, startedAt): the first report adds it, later ones raise
   * `listenedMs` (never lower it). Resolves true when the play still needs counting: the event is new, or an
   * earlier report left it `counted: false` (the count failed after the event was saved). The caller then
   * increments the count and calls `markCounted`.
   */
  record(input: PlayEventInput): Promise<boolean>;
  /** The play's count is in `plays.json`: later reports of this session no longer ask for a count. */
  markCounted(key: { source: PlaySource; trackId: string; startedAt: number }): Promise<void>;
  /** Drop every event of a release (it was deleted locally). */
  removeRelease(releaseId: string): Promise<void>;
  /** Changes every time `resetPushed` runs, like the counts store's. */
  pushedEpoch(): number;
  /** Record what the service accepted (event id -> listenedMs sent). Only moves up; a stale epoch changes nothing. */
  markPushed(sent: Record<string, number>, epoch: number): Promise<void>;
  /** Forget what was pushed, on sign-out or account deletion: every event is pending again. */
  resetPushed(): Promise<void>;
}
