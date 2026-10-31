import { useSyncExternalStore } from "react";
import type { Release, Track } from "../shared/types";
import { LOCAL_ID_PREFIX, PlayCounter, type PlaySession } from "../server/plays/PlayCounter";
import { coverUrl } from "./api-client";
import { trackArtist } from "./track-columns";

/*
 * The Mac player's queue and state (#338). The queue is a list of (release, track) pairs, not "a release's
 * tracks": every item carries its own releaseId, so a later feature (Collections, #339) can queue tracks from
 * several releases without the player changing. Title, artist, cover, the media-session metadata and the play
 * count are all resolved per item, from that item's own release.
 */

export type QueueItem = { releaseId: string; trackId: string };
export type QueueContext = { kind: "release" | "collection"; id: string };
export type PlayQueue = { items: QueueItem[]; index: number; context: QueueContext };

/** Tracks in play order: disc, then track number. A track whose file is missing is left out. */
export function playOrder(release: Pick<Release, "tracks">): Track[] {
  return release.tracks
    .filter((t) => !t.missing)
    .slice()
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || a.trackNumber - b.trackNumber);
}

/** The queue for playing `trackId` from a release's page: the release's tracks in play order, at that track. */
export function buildReleaseQueue(release: Pick<Release, "id" | "tracks">, trackId: string): PlayQueue | null {
  const ordered = playOrder(release);
  const index = ordered.findIndex((t) => t.id === trackId);
  if (index < 0) return null;
  return {
    items: ordered.map((t) => ({ releaseId: release.id, trackId: t.id })),
    index,
    context: { kind: "release", id: release.id },
  };
}

export function currentItem(queue: PlayQueue | null): QueueItem | null {
  return queue?.items[queue.index] ?? null;
}

export function sameItem(a: QueueItem | null, b: QueueItem | null): boolean {
  return a?.releaseId === b?.releaseId && a?.trackId === b?.trackId;
}

/** The URL the player loads for one item: the audio route is per release and track. */
export function audioUrl(item: QueueItem): string {
  return `/api/releases/${encodeURIComponent(item.releaseId)}/tracks/${encodeURIComponent(item.trackId)}/audio`;
}

export interface ItemInfo extends QueueItem {
  title: string;
  artist: string;
  album: string;
  /** The item's own release's cover, or null for the fallback art. */
  coverUrl: string | null;
}

/** What to show for one item, from the item's own release (never from the queue's context). Null when it is gone. */
export function describeItem(item: QueueItem, releases: readonly Release[]): ItemInfo | null {
  const release = releases.find((r) => r.id === item.releaseId);
  const track = release?.tracks.find((t) => t.id === item.trackId);
  if (!release || !track) return null;
  return {
    ...item,
    title: track.title.trim() || "Untitled",
    artist: trackArtist(undefined, release.artist),
    album: release.title,
    coverUrl: release.coverPath ? coverUrl(release.id, release.updatedAt) : null,
  };
}

/** The `navigator.mediaSession` metadata for an item: the same per-item description as the mini player. */
export function mediaMetadataFor(info: ItemInfo, origin: string): MediaMetadataInit {
  return {
    title: info.title,
    artist: info.artist,
    album: info.album,
    artwork: info.coverUrl ? [{ src: new URL(info.coverUrl, origin).toString() }] : [],
  };
}

/** What a tap on the mini player opens: the release page for a "release" queue, the Collections page for a "collection". */
export function openContext(
  context: QueueContext,
  openRelease: (id: string) => void,
  openCollection?: (id: string) => void,
): void {
  if (context.kind === "release") {
    openRelease(context.id);
    return;
  }
  openCollection?.(context.id);
}

/** "Previous" restarts the track when it has played a few seconds, else goes back one (the first track restarts). */
export const RESTART_AFTER_SEC = 3;
export function previousAction(queue: PlayQueue, positionSec: number): "restart" | "back" {
  return positionSec > RESTART_AFTER_SEC || queue.index === 0 ? "restart" : "back";
}

/**
 * Counts plays with the Mac's one rule (`PlayCounter`: min(30 s, 90% of the track), once per play session),
 * per item: the play counts for that item's own releaseId and trackId. The counter is keyed by a
 * `spotify:local:`-prefixed id it never shows anyone; a counted play comes back as the item itself.
 */
export class PlayCountSession {
  private readonly counter = new PlayCounter();
  /** The counted session in progress: what was last reported for it (#398). */
  private reported: { item: QueueItem; startedAt: number; listenedMs: number } | null = null;
  private wasPlaying = false;

  /**
   * `report` gets the item when its play counts, with the session's start and audible ms (#398). `progress`
   * gets the same item again with a larger `listenedMs`: when the player pauses, when the session ends (a skip, the
   * track finishing, the queue stopping) and as listening goes on, every `PROGRESS_STEP_MS`.
   */
  constructor(
    private readonly report: (item: QueueItem, session: PlayReport) => void,
    private readonly progress?: (item: QueueItem, session: PlayReport) => void,
  ) {}

  /** `item` null: nothing is loaded, which ends the session. */
  sample(item: QueueItem | null, s: { at: number; playing: boolean; positionSec: number; durationSec: number }): void {
    const before = this.counter.session();
    const wasPlaying = this.wasPlaying;
    this.wasPlaying = Boolean(item) && s.playing;
    if (!item) {
      this.counter.push({ at: s.at, running: false, state: "stopped", id: null, positionSec: 0, durationMs: 0 });
      this.finish(before);
      return;
    }
    const counted = this.counter.push({
      at: s.at,
      running: true,
      state: s.playing ? "playing" : "paused",
      id: `${LOCAL_ID_PREFIX}${item.releaseId}:${item.trackId}`,
      positionSec: s.positionSec,
      durationMs: Number.isFinite(s.durationSec) && s.durationSec > 0 ? s.durationSec * 1000 : 0,
    });
    const after = this.counter.session();
    if (before && this.reported && (!after || after.startedAt !== before.startedAt)) this.finish(before);
    if (counted && after) {
      this.reported = { item, startedAt: after.startedAt, listenedMs: after.listenedMs };
      this.report(item, { startedAt: after.startedAt, listenedMs: after.listenedMs });
    } else if (!this.reported && after && after.counted) {
      // The counter restored a counted session (a source switch, or a stall that ended within ten minutes): it was
      // reported when it counted, so reporting picks up its event again. Nothing is counted or reported here.
      this.reported = { item, startedAt: after.startedAt, listenedMs: after.listenedMs };
    } else if (this.reported && after && after.counted && after.startedAt === this.reported.startedAt) {
      const paused = wasPlaying && !s.playing;
      if (after.listenedMs > this.reported.listenedMs && (paused || after.listenedMs - this.reported.listenedMs >= PROGRESS_STEP_MS)) {
        this.reported = { ...this.reported, listenedMs: after.listenedMs };
        this.progress?.(item, { startedAt: after.startedAt, listenedMs: after.listenedMs });
      }
    }
  }

  /** The counted session `ended` is over: report its audible time once more if it grew since the last report. */
  private finish(ended: PlaySession | null): void {
    const last = this.reported;
    this.reported = null;
    if (ended && last && ended.startedAt === last.startedAt && ended.listenedMs > last.listenedMs) {
      this.progress?.(last.item, { startedAt: ended.startedAt, listenedMs: ended.listenedMs });
    }
  }
}

/** A counted play's session as the server is told: its start (epoch ms) and the audible ms so far. */
export interface PlayReport {
  startedAt: number;
  listenedMs: number;
}

/** How much more audible time a playing session gathers before it is reported again. */
export const PROGRESS_STEP_MS = 30_000;

export interface PlayerState {
  queue: PlayQueue | null;
  /** Whether the player is (or is about to be) playing. */
  playing: boolean;
  positionSec: number;
  durationSec: number;
  /** Items ("releaseId/trackId") whose file would not play, until they are tried again. */
  unavailable: readonly string[];
  /** Counts every load or retry of an item. A failure is reported for one attempt, and only the first report counts. */
  attempt: number;
  /** How the current item was reached: a failure after "back" stops instead of bouncing forward again. */
  move: "forward" | "back";
}

/** What the bar says about an item that would not play. */
export const COULDNT_PLAY = "Couldn't play this file";

/** What `playNext` and `addToQueue` did (#419): how many items joined, and whether that started a queue (nothing was loaded). */
export interface QueueAddOutcome {
  added: number;
  started: boolean;
}

/** A small external store: the queue and what the one audio element reports. Pure state, no audio. */
export function createPlayerStore() {
  let state: PlayerState = { queue: null, playing: false, positionSec: 0, durationSec: 0, unavailable: [], attempt: 0, move: "forward" };
  /** The attempt that has already failed, so the `play()` rejection and the `error` event of one load count once. */
  let failedAttempt = -1;
  const listeners = new Set<() => void>();
  /** The audio element's seek, registered by the one Player; without it a seek only moves the reported position. */
  let seeker: ((sec: number) => void) | null = null;
  const set = (patch: Partial<PlayerState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const startQueue = (queue: PlayQueue) => {
    set({ queue, playing: true, positionSec: 0, durationSec: 0, unavailable: [], attempt: state.attempt + 1, move: "forward" });
  };
  /** A new attempt at the current item, its mark cleared. */
  const retryAt = (index: number) => {
    const key = itemKey(state.queue?.items[index] ?? null);
    return { attempt: state.attempt + 1, unavailable: state.unavailable.filter((k) => k !== key) };
  };
  const retry = () => retryAt(state.queue?.index ?? 0);
  /**
   * Adds `items` to the queue (#419), as the iPhone's `PlaybackService.enqueue` does. With no queue (or one with no
   * current item) they start one, its context the release of the first item (the release itself, when every item
   * is from one). Otherwise they go right after the current item, or at the end, and the current item is not touched: no
   * reload, no restart. If they are not all from the queue's own release, the context becomes the current item's
   * release (the Mac has no "mixed" context).
   */
  const enqueue = (items: readonly QueueItem[], atEnd: boolean): QueueAddOutcome => {
    if (items.length === 0) return { added: 0, started: false };
    const { queue } = state;
    const current = queue?.items[queue.index];
    if (!queue || !current) {
      startQueue({ items: items.slice(), index: 0, context: { kind: "release", id: items[0].releaseId } });
      return { added: items.length, started: true };
    }
    const at = atEnd ? queue.items.length : queue.index + 1;
    const stays = queue.context.kind === "release" && items.every((i) => i.releaseId === queue.context.id);
    const context: QueueContext = stays ? queue.context : { kind: "release", id: current.releaseId };
    set({ queue: { ...queue, items: [...queue.items.slice(0, at), ...items, ...queue.items.slice(at)], context } });
    return { added: items.length, started: false };
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Start a queue and play it from its index. */
    start(queue: PlayQueue) {
      startQueue(queue);
    },
    /** Insert `items` right after the current item (#419); with no queue they start one. The current item is not touched. */
    playNext(items: readonly QueueItem[]): QueueAddOutcome {
      return enqueue(items, false);
    },
    /** Append `items` to the queue (#419); with no queue they start one. The current item is not touched. */
    addToQueue(items: readonly QueueItem[]): QueueAddOutcome {
      return enqueue(items, true);
    },
    /** Play or pause as the engine or the media keys say. Playing again is a retry: it clears the item's mark. */
    setPlaying(playing: boolean) {
      if (!state.queue || state.playing === playing) return;
      if (playing) set({ playing, ...retry() });
      else set({ playing });
    },
    toggle() {
      const { queue } = state;
      if (!queue) return;
      // Pressing play on an item that would not play tries it again.
      if (state.playing) set({ playing: false });
      else set({ playing: true, ...retry() });
    },
    /**
     * The current item's file will not play (an unsupported file, a failed load): mark it unavailable and move on to
     * the next item, or stop with the mark showing when it is the last (or was reached by going back). `key` and
     * `attempt` name the load that failed, so a second report of it (the `play()` rejection and the `error` event)
     * and a report from an earlier load count for nothing.
     */
    fail(key: string, attempt: number) {
      const { queue } = state;
      if (!queue || attempt !== state.attempt || failedAttempt === attempt || itemKey(currentItem(queue)) !== key) return;
      failedAttempt = attempt;
      const unavailable = state.unavailable.includes(key) ? state.unavailable : [...state.unavailable, key];
      if (state.move === "forward" && queue.index + 1 < queue.items.length) {
        const nextKey = itemKey(queue.items[queue.index + 1]);
        set({
          queue: { ...queue, index: queue.index + 1 },
          playing: true,
          positionSec: 0,
          durationSec: 0,
          unavailable: unavailable.filter((k) => k !== nextKey),
          attempt: state.attempt + 1,
        });
      } else {
        set({ playing: false, positionSec: 0, unavailable });
      }
    },
    /** Go to the next item. After the last one playback stops with the queue kept, on that item. */
    next() {
      const { queue } = state;
      if (!queue) return;
      if (queue.index + 1 < queue.items.length) {
        set({ queue: { ...queue, index: queue.index + 1 }, playing: true, positionSec: 0, durationSec: 0, move: "forward", ...retryAt(queue.index + 1) });
      } else set({ playing: false, positionSec: 0 });
    },
    back() {
      const { queue } = state;
      if (!queue || queue.index === 0) return;
      set({ queue: { ...queue, index: queue.index - 1 }, playing: true, positionSec: 0, durationSec: 0, move: "back", ...retryAt(queue.index - 1) });
    },
    /** The Player hands over its seek; returns the undo. */
    registerSeek(fn: (sec: number) => void) {
      seeker = fn;
      return () => {
        if (seeker === fn) seeker = null;
      };
    },
    /** Move the current track to `sec` the way the mini player does (nothing changes when no queue is loaded). */
    seek(sec: number) {
      if (!state.queue) return;
      if (seeker) seeker(sec);
      else set({ positionSec: sec });
    },
    /** The audio element's position and length, as it reports them. */
    report(positionSec: number, durationSec: number) {
      if (positionSec !== state.positionSec || durationSec !== state.durationSec) set({ positionSec, durationSec });
    },
    clear() {
      set({ queue: null, playing: false, positionSec: 0, durationSec: 0, unavailable: [], attempt: state.attempt + 1 });
    },
  };
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;

/** The one player store of the window. */
export const playerStore: PlayerStore = createPlayerStore();

export function usePlayerState(): PlayerState {
  return useSyncExternalStore(playerStore.subscribe, playerStore.getState, playerStore.getState);
}

/** One value of the player's state. The position changes about four times a second, so a component that only needs
 * the queue, the playing flag or the current item reads it through here and does not render on every tick. */
export function usePlayerSelector<T extends string | number | boolean | null>(select: (state: PlayerState) => T): T {
  return useSyncExternalStore(
    playerStore.subscribe,
    () => select(playerStore.getState()),
    () => select(playerStore.getState()),
  );
}

/** The current item as "releaseId/trackId", or null when no queue. */
export function itemKey(item: QueueItem | null): string | null {
  return item ? `${item.releaseId}/${item.trackId}` : null;
}

/** "1:02" for 62 seconds. */
export function formatClock(sec: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The scrubber's aria-valuetext: "1:02 of 3:20". */
export function scrubberText(positionSec: number, durationSec: number): string {
  return `${formatClock(positionSec)} of ${formatClock(durationSec)}`;
}
