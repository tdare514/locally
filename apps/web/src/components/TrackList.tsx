"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type SVGProps } from "react";
import { flushSync } from "react-dom";
import {
  moveAnnouncement,
  moveItem,
  nearestSlot,
  roomShift,
  slotAfterMove,
  stepTarget,
} from "../lib/track-order";
import { watchPaneEdges, type PaneEdgesWatch } from "../lib/pane-edges";
import { playsLabel } from "../lib/plays-copy";
import { formatLength } from "../lib/adopt-review";
import { adoptDiscAfterMove, discActionsFor, discHeadings, joinPreviousDisc, startDiscAt } from "../shared/discs";
import DiscMenu from "./DiscMenu";
import { XIcon } from "./Icons";
import TrackPlaylistsLine, { type PlaylistRef } from "./TrackPlaylistsLine";

export interface EditableTrack {
  /** Stable identifier for this row — a release track's `id`, or a locally-generated key
   * for a not-yet-imported file. Travels with the row when the list is reordered. */
  key: string;
  title: string;
  /** Which disc the track is on, when the release has discs. It sets the "Disc N" headings and
   * travels with the row when the list is reordered; a row moved in among another disc's rows
   * joins that disc (`moveTrack`). */
  discNumber?: number;
}

interface TrackListProps {
  tracks: EditableTrack[];
  onChange: (tracks: EditableTrack[]) => void;
  /** When provided, each row gets a remove button (used while importing, before upload). */
  onRemove?: (index: number) => void;
  /** Demo: titles can be read but not edited or reordered. */
  readOnly?: boolean;
  /** Each track's total plays by `key` (#107). A track with none, or no entry, shows nothing. */
  plays?: Record<string, number>;
  /** The Spotify playlists each track is in, by `key` (#212). A track with none, or no entry, shows nothing. */
  playlists?: Record<string, PlaylistRef[]>;
  /** Open a playlist in Spotify; the playlists line needs it. */
  onOpenPlaylist?: (id: string) => void;
  /** View mode (a release added from a Spotify folder, #249): titles are plain text, each row shows its
   * length (by `key`) where an edit would not fit, and a track whose file is gone says "File missing". */
  view?: Record<string, { durationSec: number | null; missing?: boolean }>;
}

/** Pixels the pointer must travel before a press turns into a drag. */
const DRAG_THRESHOLD = 4;
/** Distance from the scroller's top or bottom edge where a drag starts scrolling it. */
const EDGE_ZONE = 56;
/** Longest scroll step per frame, reached with the pointer at the edge. */
const EDGE_SPEED = 18;
/** How long the dropped row takes to settle into its slot; matches globals.css. */
const SETTLE_MS = 200;

/** Six dots: the grip that says "drag me". */
function GripIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      {[7, 12, 17].flatMap((cy) =>
        [9, 15].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.5} />),
      )}
    </svg>
  );
}

/** The nearest ancestor that scrolls vertically (the app's main pane), or the page itself. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** `moveItem`, then the moved row joins the disc it now sits in (`adoptDiscAfterMove`), so a
 * drop or a keyboard step never leaves a disc split in two. */
function moveTrack(tracks: EditableTrack[], from: number, to: number): EditableTrack[] {
  const moved = moveItem(tracks, from, to);
  return moved === tracks ? tracks : adoptDiscAfterMove(moved, to);
}

/** The track rows of the list, without the "Disc N" headings that sit between them. */
function trackRows(list: HTMLElement): HTMLLIElement[] {
  return Array.from(list.querySelectorAll<HTMLLIElement>(":scope > li[data-key]"));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One drag in progress. Lives in a ref: pointer moves write `translate` straight onto the row
 * elements, and React sees the new order once, on drop. */
interface Drag {
  pointerId: number;
  key: string;
  row: HTMLLIElement;
  rows: HTMLLIElement[];
  /** Each row's number text node, rewritten live so the numbers follow where rows will land. */
  numbers: (Text | null)[];
  from: number;
  to: number;
  startX: number;
  startY: number;
  clientY: number;
  startScroll: number;
  scroller: HTMLElement;
  /** The scroller's visible edges, measured once when the drag begins and kept current on resize
   * (#163), so the frame loop never reads layout. Set by `beginDrag`, released by `endDrag`. */
  pane: PaneEdgesWatch | null;
  /** Vertical centre of every slot, measured when the drag starts. A heading between two rows
   * makes the gap there larger, so rows slide by the difference between centres (`roomShift`). */
  centers: number[];
  started: boolean;
  raf: number;
}

/** A list of editable track titles that sit directly on the page, like the release page's inline
 * fields. Reorder by dragging a row (or its grip) or from the keyboard: focus the grip, then
 * Alt+Up/Down, or Space to pick up, the arrows to move, Space or Enter to drop, Escape to
 * cancel. Track numbers are implicit: they always equal the row's position (1-based). */
export default function TrackList({ tracks, onChange, onRemove, readOnly = false, plays, playlists, onOpenPlaylist, view }: TrackListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const hintId = useId();
  const [announcement, setAnnouncement] = useState("");
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null);
  /** The key of the row whose disc menu is open (#222). */
  const [discMenuKey, setDiscMenuKey] = useState<string | null>(null);

  // Latest props for handlers that outlive a render (the drop timer, window listeners).
  const tracksRef = useRef(tracks);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    tracksRef.current = tracks;
    onChangeRef.current = onChange;
  });

  const drag = useRef<Drag | null>(null);
  const settleTimer = useRef<number | null>(null);
  const grabOrigin = useRef<{ key: string; index: number; discNumber?: number } | null>(null);
  const focusKey = useRef<string | null>(null);
  /** The Escape-to-cancel listener of the drag in progress, kept so it can be removed. */
  const escapeListener = useRef<((e: KeyboardEvent) => void) | null>(null);

  // A reorder moves DOM nodes, which can drop focus from the grip; give it back.
  useLayoutEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    focusKey.current = null;
    const row = Array.from(listRef.current?.children ?? []).find(
      (li) => (li as HTMLElement).dataset.key === key,
    );
    row?.querySelector<HTMLElement>("[data-handle]")?.focus();
  });

  function updateTitle(index: number, title: string) {
    const next = tracks.slice();
    next[index] = { ...next[index], title };
    onChange(next);
  }

  /** Puts every row back to its natural place and ends the sorting state. Called in the same
   * task as the React commit that reorders the rows, so nothing flashes. */
  function clearDragStyles() {
    const list = listRef.current;
    if (!list) return;
    delete list.dataset.sorting;
    trackRows(list).forEach((li, i) => {
      li.style.translate = "";
      delete li.dataset.lifted;
      delete li.dataset.settling;
      const number = li.querySelector("[data-number]")?.firstChild;
      if (number) number.nodeValue = String(i + 1);
    });
  }

  function removeEscapeListener() {
    if (escapeListener.current) window.removeEventListener("keydown", escapeListener.current, true);
    escapeListener.current = null;
  }

  function endDrag(d: Drag, commitTo: number) {
    cancelAnimationFrame(d.raf);
    d.pane?.stop();
    removeEscapeListener();
    drag.current = null;
    if (d.row.hasPointerCapture(d.pointerId)) d.row.releasePointerCapture(d.pointerId);
    if (!d.started) return;

    const commit = () => {
      settleTimer.current = null;
      const current = tracksRef.current;
      const from = current.findIndex((t) => t.key === d.key);
      const next = moveTrack(current, from, commitTo);
      flushSync(() => {
        if (next !== current) onChangeRef.current(next);
      });
      clearDragStyles();
      if (next !== current) {
        const moved = next[commitTo];
        setAnnouncement(moveAnnouncement(moved.title, commitTo + 1, next.length));
      }
    };

    if (prefersReducedMotion()) {
      commit();
      return;
    }
    // Ease the held row into the slot it was dropped over, then commit the order.
    delete d.row.dataset.lifted;
    d.row.dataset.settling = "";
    d.row.style.translate = `0 ${d.centers[commitTo] - d.centers[d.from]}px`;
    settleTimer.current = window.setTimeout(commit, SETTLE_MS);
  }

  /** Follows the pointer with the held row and makes room for it. Cheap enough to run on every
   * move: two style writes, plus one per row only when the slot it hovers changes. */
  function updateDrag(d: Drag) {
    const first = d.centers[0];
    const last = d.centers[d.centers.length - 1];
    const wanted = d.clientY - d.startY + (d.scroller.scrollTop - d.startScroll);
    const dy = Math.min(last - d.centers[d.from], Math.max(first - d.centers[d.from], wanted));
    d.row.style.translate = `0 ${dy}px`;

    const to = nearestSlot(d.centers, d.centers[d.from] + dy);
    if (to === d.to) return;
    d.to = to;
    d.rows.forEach((li, i) => {
      if (i !== d.from) {
        const shift = roomShift(d.centers, i, d.from, to);
        li.style.translate = shift === 0 ? "" : `0 ${shift}px`;
      }
      const number = d.numbers[i];
      if (number) number.nodeValue = String(slotAfterMove(i, d.from, to) + 1);
    });
  }

  /** Scrolls the pane while the held row is near its top or bottom edge. */
  function autoScroll(d: Drag) {
    if (!d.pane) return;
    const { top, bottom } = d.pane.edges;
    let speed = 0;
    if (d.clientY < top + EDGE_ZONE) speed = -EDGE_SPEED * Math.min(1, (top + EDGE_ZONE - d.clientY) / EDGE_ZONE);
    else if (d.clientY > bottom - EDGE_ZONE) speed = EDGE_SPEED * Math.min(1, (d.clientY - (bottom - EDGE_ZONE)) / EDGE_ZONE);
    if (speed !== 0) {
      d.scroller.scrollTop += speed;
      updateDrag(d);
    }
    d.raf = requestAnimationFrame(() => autoScroll(d));
  }

  function beginDrag(d: Drag) {
    d.started = true;
    const list = listRef.current;
    if (!list) return;
    d.pane = watchPaneEdges(d.scroller);
    list.dataset.sorting = "";
    d.row.dataset.lifted = "";
    escapeListener.current = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      endDrag(d, d.from);
    };
    window.addEventListener("keydown", escapeListener.current, true);
    d.raf = requestAnimationFrame(() => autoScroll(d));
  }

  function onPointerDown(e: React.PointerEvent<HTMLOListElement>) {
    if (readOnly || drag.current || settleTimer.current !== null) return;
    if (e.button !== 0 || !e.isPrimary) return;
    const list = listRef.current;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLLIElement>("li[data-key]");
    if (!list || !row || !list.contains(row)) return;
    // The grip and the bare row start a drag; the title input and the buttons keep their own
    // behaviour.
    if (!target.closest("[data-handle]") && target.closest("input, button, a, textarea, select")) return;

    const rows = trackRows(list);
    const from = rows.indexOf(row);
    const centers = rows.map((li) => li.offsetTop + li.offsetHeight / 2);
    const scroller = scrollParent(list);
    e.preventDefault();
    row.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      key: row.dataset.key ?? "",
      row,
      rows,
      numbers: rows.map((li) => (li.querySelector("[data-number]")?.firstChild as Text | null) ?? null),
      from,
      to: from,
      startX: e.clientX,
      startY: e.clientY,
      clientY: e.clientY,
      startScroll: scroller.scrollTop,
      scroller,
      pane: null,
      centers,
      started: false,
      raf: 0,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      beginDrag(d);
    }
    updateDrag(d);
  }

  function onPointerUp(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    endDrag(d, d.to);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLOListElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    endDrag(d, d.from);
  }

  // Leaving mid-drag (a route change, say) must not leave a timer, a frame or a listener behind.
  useEffect(() => {
    const state = { drag, settleTimer, escapeListener };
    return () => {
      if (state.drag.current) {
        cancelAnimationFrame(state.drag.current.raf);
        state.drag.current.pane?.stop();
      }
      if (state.settleTimer.current !== null) window.clearTimeout(state.settleTimer.current);
      if (state.escapeListener.current) {
        window.removeEventListener("keydown", state.escapeListener.current, true);
      }
    };
  }, []);

  /** Moves the row at `index` by one place and keeps focus on its grip. */
  function step(index: number, dir: -1 | 1) {
    const track = tracks[index];
    const target = stepTarget(index, dir, tracks.length);
    if (target === null) {
      setAnnouncement(`${track.title.trim() || "Track"} is already ${dir === -1 ? "first" : "last"}`);
      return;
    }
    focusKey.current = track.key;
    onChange(moveTrack(tracks, index, target));
    setAnnouncement(moveAnnouncement(track.title, target + 1, tracks.length));
  }

  function onHandleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const track = tracks[index];
    const name = track.title.trim() || "track";
    const grabbed = grabbedKey === track.key;

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (e.altKey || grabbed)) {
      e.preventDefault();
      step(index, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (grabbed) {
        grabOrigin.current = null;
        setGrabbedKey(null);
        setAnnouncement(`Dropped ${name} at position ${index + 1} of ${tracks.length}`);
      } else {
        grabOrigin.current = { key: track.key, index, discNumber: track.discNumber };
        setGrabbedKey(track.key);
        setAnnouncement(
          `Picked up ${name}, position ${index + 1} of ${tracks.length}. Use the up and down arrow keys to move it, Space to drop it, Escape to cancel.`,
        );
      }
    } else if (e.key === "Escape" && grabbed) {
      e.preventDefault();
      e.stopPropagation();
      const origin = grabOrigin.current;
      grabOrigin.current = null;
      setGrabbedKey(null);
      if (origin && (origin.index !== index || origin.discNumber !== track.discNumber)) {
        focusKey.current = track.key;
        // Back to where it was picked up, and to the disc it was on: steps along the way may have
        // moved it into another disc.
        const back = moveItem(tracks, index, origin.index).slice();
        const restored: EditableTrack = { ...back[origin.index] };
        if (origin.discNumber === undefined) delete restored.discNumber;
        else restored.discNumber = origin.discNumber;
        back[origin.index] = restored;
        onChange(back);
      }
      setAnnouncement(`Cancelled. ${name} is back at position ${(origin?.index ?? index) + 1} of ${tracks.length}`);
    }
  }

  if (tracks.length === 0) {
    return <p className="text-sm text-text-muted">No tracks yet.</p>;
  }

  const headings = discHeadings(tracks.map((t) => t.discNumber));
  const discs = tracks.map((t) => t.discNumber);
  const canEditDiscs = !readOnly && !view && tracks.length >= 2;

  /** Applies a disc action through `onChange`, the path a drag-reorder takes, and gives focus back to
   * the row's grip (the number's button may be gone, once the row no longer has an action). */
  function applyDiscAction(key: string, next: EditableTrack[]) {
    setDiscMenuKey(null);
    focusKey.current = key;
    onChange(next);
  }

  return (
    <>
      <ol
        ref={listRef}
        className="track-list relative flex flex-col divide-y"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {tracks.map((track, index) => {
          const grabbed = grabbedKey === track.key;
          const heading = headings[index];
          const playTotal = plays?.[track.key] ?? 0;
          const viewInfo = view?.[track.key];
          const discActions = canEditDiscs ? discActionsFor(discs, index) : {};
          const hasDiscActions = discActions.start !== undefined || discActions.join !== undefined;
          const row = (
            <li
              key={track.key}
              data-key={track.key}
              data-grabbed={grabbed ? "" : undefined}
              className={`track-row -mx-2 flex h-12 items-center gap-3 px-2 hover:bg-white/[0.03] data-[grabbed]:bg-white/[0.07] ${
                readOnly ? "" : "cursor-grab"
              } ${viewInfo?.missing ? "text-text-muted" : ""}`}
              onContextMenu={(e) => {
                // The row's disc menu; the title input keeps the system one (copy and paste).
                if (!hasDiscActions || (e.target as HTMLElement).closest("input, textarea")) return;
                e.preventDefault();
                setDiscMenuKey(track.key);
              }}
            >
              {/* The glass tile: shown only while this row is held. */}
              <span aria-hidden className="track-tile glass-fake glass-frost" />
              {hasDiscActions ? (
                <DiscMenu
                  number={index + 1}
                  actions={discActions}
                  open={discMenuKey === track.key}
                  onOpenChange={(open) => setDiscMenuKey(open ? track.key : null)}
                  onStart={() => applyDiscAction(track.key, startDiscAt(tracks, index))}
                  onJoin={() => applyDiscAction(track.key, joinPreviousDisc(tracks, index))}
                />
              ) : (
                <span data-number className="w-6 shrink-0 text-sm tabular-nums text-white/60">
                  {index + 1}
                </span>
              )}
              <div className="flex min-w-0 flex-col items-start">
                {view ? (
                  <span
                    className={`py-0.5 text-[15px] font-semibold tracking-[-0.01em] ${
                      viewInfo?.missing ? "text-text-muted" : "text-text"
                    }`}
                  >
                    {track.title || "Untitled"}
                  </span>
                ) : (
                <input
                  type="text"
                  aria-label={`Track ${index + 1} title`}
                  value={track.title}
                  readOnly={readOnly}
                  onChange={(e) => updateTitle(index, e.target.value)}
                  placeholder="Track title"
                  className="field-sizing-content -mx-1.5 min-w-[8ch] cursor-text rounded-md bg-transparent px-1.5 py-0.5 text-[15px] font-semibold tracking-[-0.01em] text-text outline-none placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
                />
                )}
                {onOpenPlaylist && (playlists?.[track.key]?.length ?? 0) > 0 && (
                  <TrackPlaylistsLine
                    trackTitle={track.title}
                    playlists={playlists?.[track.key] ?? []}
                    onOpen={onOpenPlaylist}
                  />
                )}
              </div>
              <span aria-hidden className="min-w-0 flex-1" />
              {viewInfo?.missing ? (
                <span className="shrink-0 text-xs text-text-dim">File missing</span>
              ) : viewInfo && viewInfo.durationSec !== null ? (
                <span className="shrink-0 text-sm tabular-nums text-text-muted">{formatLength(viewInfo.durationSec)}</span>
              ) : null}
              {playTotal > 0 && (
                <span data-plays className="shrink-0 text-sm tabular-nums text-text-muted">
                  {playsLabel(playTotal)}
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  data-handle
                  aria-label={`Reorder ${track.title.trim() || "track"}, position ${index + 1} of ${tracks.length}`}
                  aria-pressed={grabbed}
                  aria-describedby={hintId}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onKeyDown={(e) => onHandleKeyDown(e, index)}
                  onBlur={() => {
                    // A reorder can blur the grip while it moves in the DOM; focus comes back.
                    if (grabbed && focusKey.current !== track.key) {
                      grabOrigin.current = null;
                      setGrabbedKey(null);
                    }
                  }}
                  className="track-affordance flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-white outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <GripIcon className="size-4" />
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${track.title.trim() || `track ${index + 1}`}`}
                  className="track-affordance flex size-8 shrink-0 items-center justify-center rounded-md text-white outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <XIcon className="size-4" />
                </button>
              )}
            </li>
          );
          if (heading === null) return row;
          // A quiet heading above the first row of each disc; not a track, so the drag code skips it.
          return [
            <li
              key={`disc-${index}`}
              role="presentation"
              data-disc-heading
              className="border-0 pb-1 pt-5 text-sm font-medium text-text-muted first:pt-0"
            >
              Disc {heading}
            </li>,
            row,
          ];
        })}
      </ol>
      {!readOnly && (
        <p id={hintId} className="sr-only">
          Press Space on a track&rsquo;s grip to pick it up, the up and down arrow keys to move it,
          and Space to drop it. Or hold Alt and press an arrow key to move it one place.
        </p>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </>
  );
}
