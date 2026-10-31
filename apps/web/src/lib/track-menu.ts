import type { Release, Track } from "../shared/types";
import { creditKey } from "./artist-catalog";
import { playOrder, type PlayerStore, type QueueAddOutcome, type QueueItem } from "./play-queue";

/*
 * The one track menu of the Mac (#419): the iPhone's `TrackActionsMenu` actions in its order and wording
 * (`Copy.TrackActions`), minus Song info (the Mac has no song page yet). This file is the pure part: what the
 * menu acts on, what it offers, and the toast a queue action shows. `components/TrackMenu.tsx` draws it.
 */

/** The iPhone's wording, from `Copy.TrackActions`. */
export const TRACK_ACTIONS = {
  playNext: "Play next",
  addToQueue: "Add to queue",
  addToCollection: "Add to collection",
  share: "Share",
  edit: "Edit",
  goToAlbum: "Go to album",
  goToArtist: "Go to artist",
  playingNow: "Playing now",
  playingNext: "Playing next",
  addedToQueue: "Added to queue",
} as const;

export interface TrackMenuItem {
  id: string;
  label: string;
  run: () => void;
}

/** What a row can do. An action the row can't do is left out, and the menu does not show it (never a disabled item). */
export interface TrackMenuActions {
  playNext?: () => void;
  addToQueue?: () => void;
  addToCollection?: () => void;
  share?: () => void;
  edit?: () => void;
  goToAlbum?: () => void;
  goToArtist?: () => void;
  /** The Mac's editing actions of a track row ("Start disc N here", "Join disc N"), a last group of their own. */
  disc?: { label: string; run: () => void }[];
}

/**
 * The menu's groups in the iPhone's order: Play next, Add to queue, Add to collection, Share; then Edit, Go to
 * album, Go to artist; then the disc actions. The menu draws a divider between groups, and none for a group that
 * is empty.
 */
export function trackMenuGroups(a: TrackMenuActions): TrackMenuItem[][] {
  const item = (id: string, label: string, run: (() => void) | undefined): TrackMenuItem[] => (run ? [{ id, label, run }] : []);
  return [
    [
      ...item("play-next", TRACK_ACTIONS.playNext, a.playNext),
      ...item("add-to-queue", TRACK_ACTIONS.addToQueue, a.addToQueue),
      ...item("add-to-collection", TRACK_ACTIONS.addToCollection, a.addToCollection),
      ...item("share", TRACK_ACTIONS.share, a.share),
    ],
    [
      ...item("edit", TRACK_ACTIONS.edit, a.edit),
      ...item("go-to-album", TRACK_ACTIONS.goToAlbum, a.goToAlbum),
      ...item("go-to-artist", TRACK_ACTIONS.goToArtist, a.goToArtist),
    ],
    (a.disc ?? []).map((d, i) => ({ id: `disc-${i}`, label: d.label, run: d.run })),
  ].filter((group) => group.length > 0);
}

/** What the menu acts on: one track of a release, or (no `trackId`) the whole release in play order, as the iPhone's `.release` target. */
export interface MenuTarget {
  release: Release;
  trackId?: string;
}

/** The tracks the target stands for, in play order. A track whose file is missing can't be queued, so it is left out. */
function targetTracks(target: MenuTarget): Track[] {
  const ordered = playOrder(target.release);
  return target.trackId === undefined ? ordered : ordered.filter((t) => t.id === target.trackId);
}

export function targetItems(target: MenuTarget): QueueItem[] {
  return targetTracks(target).map((t) => ({ releaseId: target.release.id, trackId: t.id }));
}

/** The toast's subject: the song's title, or "3 songs". */
export function targetSubject(target: MenuTarget): string {
  const tracks = targetTracks(target);
  if (tracks.length === 1) return tracks[0].title.trim() || "Untitled";
  return `${tracks.length} songs`;
}

/** "Playing next: Night Bus to Nowhere"; null when nothing was added. */
export function queueToastText(outcome: QueueAddOutcome, next: boolean, subject: string): string | null {
  if (outcome.added === 0) return null;
  const head = outcome.started ? TRACK_ACTIONS.playingNow : next ? TRACK_ACTIONS.playingNext : TRACK_ACTIONS.addedToQueue;
  return `${head}: ${subject}`;
}

/** How a surface reaches the app: its toast, and the pages the menu opens (a surface leaves out one it can't open). */
export interface TrackMenuEnv {
  toast: (kind: "success" | "error", text: string) => void;
  /** Opens a release's page (Edit and Go to album, off the release's own page). */
  openRelease?: (id: string) => void;
  /** Opens an artist's page for a credit as the release shows it (AppShell: `pushTo({ type: "artist", key: creditKey(name) })`). */
  openArtist?: (name: string) => void;
}

/** Queues the target (after the current item for `next`, else at the end) and says so in a toast. */
export function queueTarget(
  store: Pick<PlayerStore, "playNext" | "addToQueue">,
  target: MenuTarget,
  next: boolean,
  toast: TrackMenuEnv["toast"],
): void {
  const items = targetItems(target);
  const outcome = next ? store.playNext(items) : store.addToQueue(items);
  const text = queueToastText(outcome, next, targetSubject(target));
  if (text) toast("success", text);
}

/**
 * The actions every surface shares for a target. Queue actions are off in the demo (it has no files to play, and
 * no player) and for a target with nothing playable. Edit opens the release page, so it is off where the release
 * can't be edited (an adopted release, the demo). A surface adds what only it can do (the row's collection and
 * share controls, its title field, its disc actions) and leaves out what it must not show (Go to album on that
 * album's own page).
 */
export function targetActions(
  target: MenuTarget,
  env: TrackMenuEnv,
  store: Pick<PlayerStore, "playNext" | "addToQueue">,
  demo: boolean,
): TrackMenuActions {
  const { release } = target;
  const queueable = !demo && targetItems(target).length > 0;
  const { openRelease, openArtist } = env;
  return {
    playNext: queueable ? () => queueTarget(store, target, true, env.toast) : undefined,
    addToQueue: queueable ? () => queueTarget(store, target, false, env.toast) : undefined,
    edit: openRelease && !demo && !release.adopted ? () => openRelease(release.id) : undefined,
    goToAlbum: openRelease ? () => openRelease(release.id) : undefined,
    goToArtist: openArtist && creditKey(release.artist) !== "" ? () => openArtist(release.artist) : undefined,
  };
}
