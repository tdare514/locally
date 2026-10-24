"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Release } from "../shared/types";
import type { CollectionRecord } from "../shared/collections";
import {
  buildCollectionQueue,
  collectionCoverIds,
  collectionTotals,
  filterCollections,
} from "../lib/collections";
import { coverUrl } from "../lib/api-client";
import { normalizeSearchText } from "../lib/library-sections";
import { currentItem, describeItem, itemKey, playerStore, usePlayerSelector } from "../lib/play-queue";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import {
  WHEEL,
  easeToward,
  findByPrefix,
  frontIndex,
  nextTyped,
  rowCaption,
  rowLabel,
  rowPose,
  scrollToSteps,
  turnTarget,
  windowIndexes,
  wrapD,
  type SpinningRecord,
} from "../lib/record-player";
import AmbientBackdrop from "./AmbientBackdrop";
import CollectionSleeve from "./CollectionSleeve";
import { ChevronRightIcon, NextTrackIcon, PauseIcon, PlayIcon, PlusIcon, SearchIcon } from "./Icons";
import NoCover from "./NoCover";

/** Rows kept in the DOM round the front (the dial shows about seven; the rest is slack for a fast turn). */
const MOUNT_STEPS = 8;
const PREVIEW_DELAY_MS = 60;
const SNAP_AFTER_SCROLL_MS = 140;

interface Props {
  collections: CollectionRecord[];
  releases: Release[];
  /** The collection to start on (the mini player opens the page on the playing one), or a new one just made. */
  selectedId?: string;
  record: SpinningRecord;
  onNew: () => void;
  /** The queue panel under the deck for the collection in front (the page's own, with Edit and the playlist guide). */
  renderQueue: (collection: CollectionRecord) => ReactNode;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "collection:id" of the player's queue, or null (a release queue or none). */
const playingCollectionId = (context: string | null) => (context?.startsWith("collection:") ? context.slice("collection:".length) : null);

/**
 * The Collections page as a record player (#351): a half wheel of collections on the left, the turntable on the
 * right, the front collection's queue below. Browsing only previews: the player store is never touched until Play.
 * The wheel is laid out by hand each frame, but only for the rows near the front and only while it turns; the deck is
 * React-rendered with stable keys so a pause, skip or turn updates it in place and the record never remounts.
 */
export default function RecordPlayerView({ collections, releases, selectedId, record, onNew, renderQueue }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterCollections(collections, query, normalizeSearchText), [collections, query]);
  const n = shown.length;
  const idsKey = useMemo(() => shown.map((c) => c.id).join("|"), [shown]);

  const context = usePlayerSelector((s) => (s.queue ? `${s.queue.context.kind}:${s.queue.context.id}` : null));
  const playing = usePlayerSelector((s) => s.playing);
  const hasQueue = context !== null;
  const nowId = playingCollectionId(context);

  // ---- the wheel's state -------------------------------------------------------------------
  const [initial] = useState(() => {
    const at = shown.findIndex((c) => c.id === (selectedId ?? nowId));
    return at >= 0 ? at : 0;
  });
  const pos = useRef(initial);
  const target = useRef(initial);
  const [front, setFront] = useState(initial);
  const frontRef = useRef(initial);
  const [previewId, setPreviewId] = useState<string | null>(shown[initial]?.id ?? null);

  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const lit = useRef(new Set<string>());
  const height = useRef(600);
  const raf = useRef(0);
  const lastT = useRef(0);
  const live = useRef(true);
  const [isLive, setIsLive] = useState(true);
  const shownRef = useRef(shown);
  const frontIdRef = useRef<string | null>(shown[initial]?.id ?? null);
  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  /** Places the rows near the front. Rows beyond the window are never touched: `windowIndexes` is the cull. */
  const layout = useCallback(() => {
    const list = shownRef.current;
    const count = list.length;
    const cy = height.current / 2;
    const g = WHEEL;
    const next = new Set<string>();
    for (const i of windowIndexes(pos.current, count)) {
      const c = list[i];
      const el = rowEls.current.get(c.id);
      if (!el) continue;
      const pose = rowPose(wrapD(i, pos.current, count), g);
      if (!pose) continue;
      next.add(c.id);
      el.style.visibility = "visible";
      el.style.transform = `translate(${pose.x - g.base / 2}px, ${cy + pose.y - g.base / 2}px) scale(${pose.scale})`;
      el.style.opacity = String(pose.opacity);
      el.style.zIndex = String(pose.z);
      el.style.setProperty("--k", pose.scale.toFixed(3));
    }
    for (const id of lit.current) {
      if (next.has(id)) continue;
      const el = rowEls.current.get(id);
      if (el) {
        el.style.visibility = "hidden";
        el.style.opacity = "0";
      }
    }
    lit.current = next;
  }, []);

  const syncFront = useCallback(() => {
    const f = frontIndex(pos.current, shownRef.current.length);
    if (f !== frontRef.current) {
      frontRef.current = f;
      frontIdRef.current = shownRef.current[f]?.id ?? null;
      setFront(f);
    }
  }, []);

  // One frame of a turn. Kept in a ref so the loop can schedule itself.
  const frame = useRef<FrameRequestCallback>(() => {});
  const schedule = useCallback(() => {
    raf.current = requestAnimationFrame((t) => frame.current(t));
  }, []);
  useEffect(() => {
    frame.current = (t) => {
      const dt = lastT.current ? t - lastT.current : 16;
      lastT.current = t;
      pos.current = easeToward(pos.current, target.current, Math.min(dt, 64));
      layout();
      syncFront();
      if (pos.current === target.current) {
        raf.current = 0;
        lastT.current = 0;
      } else schedule();
    };
  }, [layout, syncFront, schedule]);

  /** Turns the wheel to `t` (an unwrapped row count). Animated only while it moves; jumps under Reduce Motion or off screen. */
  const turnTo = useCallback(
    (t: number) => {
      target.current = t;
      if (reducedMotion() || !live.current) {
        if (raf.current) cancelAnimationFrame(raf.current);
        raf.current = 0;
        lastT.current = 0;
        pos.current = t;
        layout();
        syncFront();
        return;
      }
      if (!raf.current) schedule();
    },
    [layout, syncFront, schedule],
  );

  const turnToIndex = useCallback((i: number) => turnTo(turnTarget(i, target.current, shownRef.current.length)), [turnTo]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // After each render, rows that just mounted get their place (they start hidden).
  useLayoutEffect(() => {
    shownRef.current = shown;
    layout();
  });

  // The list of collections changed (search, add, delete): keep the front one when it is still there.
  const idsRef = useRef(idsKey);
  useEffect(() => {
    if (idsRef.current === idsKey) return;
    idsRef.current = idsKey;
    const was = frontIdRef.current;
    const at = was ? shownRef.current.findIndex((c) => c.id === was) : -1;
    const i = at >= 0 ? at : Math.min(frontRef.current, Math.max(0, n - 1));
    frontIdRef.current = shownRef.current[i]?.id ?? null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    pos.current = target.current = i;
    frontRef.current = i;
    setFront(i);
    layout();
  }, [idsKey, n, layout]);

  // A collection chosen from outside (just made, or the mini player) comes to the front.
  const firstSelected = useRef(true);
  useEffect(() => {
    if (firstSelected.current) {
      firstSelected.current = false;
      return;
    }
    const at = selectedId ? shownRef.current.findIndex((c) => c.id === selectedId) : -1;
    if (at >= 0) turnToIndex(at);
  }, [selectedId, turnToIndex]);

  // The preview (the hovering cover, the queue, the page's colours) follows the wheel a moment after it settles.
  const frontId = shown[front]?.id ?? null;
  useEffect(() => {
    const t = setTimeout(() => setPreviewId(frontId), reducedMotion() ? 0 : PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [frontId]);
  const preview = collections.find((c) => c.id === previewId) ?? shown[front] ?? null;

  // The wheel's height, once and when it changes (never read per frame).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    height.current = el.clientHeight || 600;
    const ro = new ResizeObserver(() => {
      height.current = el.clientHeight || 600;
      layout();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, n]);

  // Pause the wheel and the spin while the page is hidden or the record player is scrolled out of view.
  useEffect(() => {
    let visible = !document.hidden;
    let inView = true;
    const apply = () => {
      live.current = visible && inView;
      setIsLive(live.current);
    };
    const onVis = () => {
      visible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | null = null;
    if (rootRef.current && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        apply();
      });
      io.observe(rootRef.current);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, []);

  // ---- input -------------------------------------------------------------------------------
  const snapTimer = useRef(0);
  const snap = useCallback(() => turnTo(Math.round(target.current)), [turnTo]);

  const playFront = useCallback(() => {
    const c = shownRef.current[frontRef.current];
    if (!c) return;
    const q = playerStore.getState().queue;
    if (q && q.context.kind === "collection" && q.context.id === c.id) {
      playerStore.toggle();
      return;
    }
    const queue = buildCollectionQueue(c, releases);
    if (queue) playerStore.start(queue);
  }, [releases]);

  // Scroll turns the wheel. A native listener, because React's wheel handlers are passive and cannot hold the page still.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (shownRef.current.length < 2) return;
      e.preventDefault();
      turnTo(target.current + scrollToSteps(e.deltaX, e.deltaY, e.deltaMode));
      window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(snap, SNAP_AFTER_SCROLL_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(snapTimer.current);
    };
  }, [turnTo, snap, n]);

  const drag = useRef<{ x: number; y: number; t: number; moved: boolean; id: string | null } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-rp-id]");
    drag.current = { x: e.clientX, y: e.clientY, t: target.current, moved: false, id: row?.dataset.rpId ?? null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6 || Math.abs(e.clientX - d.x) > 6) d.moved = true;
    if (d.moved && shownRef.current.length > 1) turnTo(d.t - dy / (WHEEL.row * 0.8));
  };
  const endDrag = (cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved || cancelled) {
      snap();
      return;
    }
    if (!d.id) return;
    const i = shownRef.current.findIndex((c) => c.id === d.id);
    if (i < 0) return;
    if (i === frontRef.current) playFront();
    else turnToIndex(i);
  };

  const typed = useRef({ text: "", at: 0 });
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // The wheel itself only: never a button or field near it.
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const count = shownRef.current.length;
    if (count === 0) return;
    const at = Math.round(target.current);
    const go = (t: number) => {
      turnTo(t);
      e.preventDefault();
    };
    switch (e.key) {
      case "ArrowDown": return go(at + 1);
      case "ArrowUp": return go(at - 1);
      case "PageDown": return go(at + 5);
      case "PageUp": return go(at - 5);
      case "Home": return go(turnTarget(0, at, count));
      case "End": return go(turnTarget(count - 1, at, count));
      case "Enter":
        e.preventDefault();
        return playFront();
      default:
    }
    if (e.key.length !== 1) return;
    const now = performance.now();
    const active = now - typed.current.at <= 700 && typed.current.text !== "";
    if (e.key === " " && !active) return; // a space only continues a word
    typed.current = { text: nextTyped(typed.current.text, typed.current.at, e.key.toLowerCase(), now), at: now };
    const names = shownRef.current.map((c) => normalizeSearchText(c.name));
    const hit = findByPrefix(names, normalizeSearchText(typed.current.text), frontRef.current);
    if (hit !== null) go(turnTarget(hit, at, count));
    else e.preventDefault();
  };

  // ---- the player's state for the wheel's rows and the deck -----------------------------------
  const rowState: "playing" | "paused" = playing ? "playing" : "paused";
  const frontCollection = shown[front] ?? null;
  const coverIds = preview ? collectionCoverIds(preview.items, releases) : [];
  const washRelease = coverIds.length > 0 ? releases.find((r) => r.id === coverIds[0]) : undefined;
  const palette = useArtworkPalette(washRelease ? coverUrl(washRelease.id, washRelease.updatedAt) : null);

  const mounted = windowIndexes(front, n, MOUNT_STEPS);

  return (
    <div className="rp-root" data-live={isLive ? "true" : "false"}>
      <AmbientBackdrop palette={palette} />
      <div ref={rootRef} className="rp-grid">
       <div className="rp-cols">
        <div className="rp-left">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              aria-label="Search collections"
              placeholder="Search collections"
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-11 w-full rounded-full bg-elevated pl-11 pr-4 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          {n === 0 ? (
            <p className="mt-4 text-sm text-text-muted">No collection matches “{query.trim()}”.</p>
          ) : (
            <div className="rp-wheel">
              <div className="rp-ring" aria-hidden="true" />
              <div className="rp-notch" aria-hidden="true" />
              <div
                ref={listRef}
                tabIndex={0}
                role="listbox"
                aria-label="Your collections. Up and down arrows turn the wheel, Enter plays the one in front, or type a name."
                aria-activedescendant={frontCollection ? `rp-opt-${frontCollection.id}` : undefined}
                className="rp-list"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => endDrag(false)}
                onPointerCancel={() => endDrag(true)}
                onKeyDown={onKeyDown}
              >
                {mounted.map((i) => {
                  const c = shown[i];
                  return (
                    <WheelRow
                      key={c.id}
                      collection={c}
                      releases={releases}
                      index={i}
                      count={n}
                      isFront={i === front}
                      state={nowId === c.id ? rowState : null}
                      register={register}
                    />
                  );
                })}
              </div>
              <div className="rp-hub">
                <div className="rp-hub-face">
                  <button type="button" aria-label="Previous collection" className="rp-hub-btn" onClick={() => turnTo(Math.round(target.current) - 1)}>
                    <ChevronRightIcon className="size-4 -rotate-90" />
                  </button>
                  <span className="rp-cnt">
                    <b>{front + 1}</b> <span>of {n}</span>
                  </span>
                  <button type="button" aria-label="Next collection" className="rp-hub-btn" onClick={() => turnTo(Math.round(target.current) + 1)}>
                    <ChevronRightIcon className="size-4 rotate-90" />
                  </button>
                  <button type="button" aria-label="New collection" className="rp-hub-btn rp-hub-plus" onClick={onNew}>
                    <PlusIcon className="size-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="rp-right">
          <Deck
            preview={preview}
            collections={collections}
            releases={releases}
            record={record}
            goHome={() => {
              const at = nowId ? shown.findIndex((c) => c.id === nowId) : -1;
              if (at >= 0) {
                turnToIndex(at);
                // "Back to" goes away once the wheel is home, so focus moves to the wheel.
                listRef.current?.focus();
              }
            }}
            nowInList={nowId ? shown.some((c) => c.id === nowId) : false}
            hasQueue={hasQueue}
          />
        </div>
       </div>
      </div>
      {preview && <div className="rp-queue">{renderQueue(preview)}</div>}
    </div>
  );
}

/** One collection on the wheel. Its place is set by the layout loop through the element, never through props. */
const WheelRow = memo(function WheelRow({
  collection,
  releases,
  index,
  count,
  isFront,
  state,
  register,
}: {
  collection: CollectionRecord;
  releases: Release[];
  index: number;
  count: number;
  isFront: boolean;
  state: "playing" | "paused" | null;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const totals = useMemo(() => collectionTotals(collection.items, releases), [collection.items, releases]);
  return (
    <div
      ref={(el) => register(collection.id, el)}
      id={`rp-opt-${collection.id}`}
      role="option"
      aria-selected={isFront}
      aria-label={rowLabel(collection.name, totals.tracks, state)}
      aria-posinset={index + 1}
      aria-setsize={count}
      data-rp-id={collection.id}
      data-front={isFront ? "true" : "false"}
      className="rp-row"
    >
      <span className="rp-sleeve">
        <CollectionSleeve items={collection.items} releases={releases} className="size-full rounded-none!" />
      </span>
      <span className="rp-text">
        <b>{collection.name}</b>
        <small>
          {state && (
            <span className="rp-state">
              <i aria-hidden="true" />
              <em>{state === "playing" ? "Playing" : "Paused"}</em>
            </span>
          )}
          <span>{rowCaption(totals.tracks, totals.seconds)}</span>
        </small>
      </span>
    </div>
  );
});

/**
 * The turntable. The platter, the record on it and the controls are mounted once and patched in place: a pause, a skip,
 * a turn of the wheel or a new collection changes a class, a style value or a text, never the elements.
 */
function Deck({
  preview,
  collections,
  releases,
  record,
  goHome,
  nowInList,
  hasQueue,
}: {
  preview: CollectionRecord | null;
  collections: CollectionRecord[];
  releases: Release[];
  record: SpinningRecord;
  goHome: () => void;
  nowInList: boolean;
  hasQueue: boolean;
}) {
  const playing = usePlayerSelector((s) => s.playing);
  const context = usePlayerSelector((s) => (s.queue ? `${s.queue.context.kind}:${s.queue.context.id}` : null));
  const trackKey = usePlayerSelector((s) => itemKey(currentItem(s.queue)));
  const position = usePlayerSelector((s) => (s.queue ? s.queue.index : -1));
  const length = usePlayerSelector((s) => (s.queue ? s.queue.items.length : 0));
  const nowId = playingCollectionId(context);
  const nowCollection = nowId ? collections.find((c) => c.id === nowId) ?? null : null;

  const item = useMemo(() => {
    if (!trackKey) return null;
    const [releaseId, trackId] = trackKey.split("/");
    return describeItem({ releaseId, trackId }, releases);
  }, [trackKey, releases]);
  const art = item?.coverUrl ?? null;

  const here = hasQueue && preview !== null && nowId === preview.id;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);

  // The record goes onto the platter when another collection starts (not on the first paint).
  const vinylRef = useRef<HTMLDivElement>(null);
  const lastContext = useRef(context);
  useEffect(() => {
    if (lastContext.current === context) return;
    lastContext.current = context;
    const v = vinylRef.current;
    if (!v || context === null || reducedMotion()) return;
    v.classList.remove("rp-swap");
    void v.offsetWidth;
    v.classList.add("rp-swap");
  }, [context]);

  // A control that goes away because it was pressed hands focus to the one that carries on.
  useEffect(() => {
    if (handoff.current && here) toggleRef.current?.focus();
    handoff.current = false;
  }, [here]);

  const canPlay = preview ? buildCollectionQueue(preview, releases) !== null : false;
  const startPreview = () => {
    if (!preview) return;
    const queue = buildCollectionQueue(preview, releases);
    if (!queue) return;
    handoff.current = true;
    playerStore.start(queue);
  };

  const eyebrow = !item
    ? ""
    : nowCollection
      ? `${nowCollection.name} · track ${position + 1} of ${length}`
      : `${item.album} · track ${position + 1} of ${length}`;
  const away = nowCollection !== null && !here && nowInList;
  const state: "playing" | "paused" = playing ? "playing" : "paused";
  const faceStyle = { "--art": art ? `url(${art})` : "none" } as CSSProperties;
  const picture = record === "picture" && art !== null;

  return (
    <section className="rp-scene" aria-label="Record player" data-state={hasQueue ? state : "idle"}>
      <div className="rp-deck-top glass-fake" aria-hidden="true" />
      <div className="rp-deck-front" aria-hidden="true">
        <i className="rp-knob" style={{ right: 64 }} />
        <i className="rp-knob" style={{ right: 30 }} />
      </div>
      <div className="rp-shadow" aria-hidden="true" />
      <div className="rp-platter" aria-hidden="true">
        <div className="rp-rim" />
        <div className="rp-mat" />
        <div ref={vinylRef} className="rp-vinyl">
          <div className="rp-face" data-picture={picture ? "true" : "false"} style={faceStyle}>
            <span className="rp-label" style={art ? { backgroundImage: `url(${art})` } : undefined} />
            <span className="rp-hole" />
          </div>
          <div className="rp-glint" />
        </div>
      </div>
      <div className="rp-float-slot">
        {preview &&
          (here ? (
            <div key={`here:${trackKey}`} className="rp-float rp-float-single">
              {art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={art} alt="" />
              ) : (
                <NoCover className="size-full" />
              )}
              <span className="rp-tag">
                <i aria-hidden="true" />
                <em>{state === "playing" ? "Playing" : "Paused"}</em>
              </span>
            </div>
          ) : (
            <div key={`pre:${preview.id}`} className="rp-float">
              <CollectionSleeve items={preview.items} releases={releases} className="size-full rounded-none!" />
              <button type="button" disabled={!canPlay} onClick={startPreview} aria-label={`Play ${preview.name}`} className="rp-float-play">
                <PlayIcon className="size-4 shrink-0" />
                <span className="truncate">Play {preview.name}</span>
              </button>
            </div>
          ))}
      </div>
      <div className="rp-arm" aria-hidden="true">
        <div className="rp-rod" />
      </div>
      <div className="rp-now">
        {item ? (
          <>
            <p className="rp-k">{eyebrow}</p>
            <h2 className="rp-title">{item.title}</h2>
            <p className="rp-artist">{item.artist}</p>
          </>
        ) : (
          <h2 className="rp-title">Nothing playing</h2>
        )}
        <Progress />
        <div className="rp-ctrl">
          <button
            type="button"
            aria-label="Previous track"
            aria-disabled={!hasQueue || position <= 0}
            className="rp-round"
            onClick={() => {
              if (position > 0) playerStore.back();
            }}
          >
            <NextTrackIcon className="size-5 -scale-x-100" />
          </button>
          <button
            ref={toggleRef}
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            aria-disabled={!hasQueue}
            className="rp-round rp-main"
            onClick={() => {
              if (hasQueue) playerStore.toggle();
            }}
          >
            {playing ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
          </button>
          <button
            type="button"
            aria-label="Next track"
            aria-disabled={!hasQueue || position + 1 >= length}
            className="rp-round"
            onClick={() => {
              if (position + 1 < length) playerStore.next();
            }}
          >
            <NextTrackIcon className="size-5" />
          </button>
        </div>
        {away && nowCollection && (
          <button type="button" className="btn-ink min-h-11" onClick={goHome}>
            <span className="btn-ink-label">Back to {nowCollection.name}</span>
          </button>
        )}
      </div>
    </section>
  );
}

/** The thin progress line under the title: its own component so a position tick (four a second) renders nothing else. */
function Progress() {
  const permille = usePlayerSelector((s) => (s.durationSec > 0 ? Math.min(1000, Math.round((s.positionSec / s.durationSec) * 1000)) : 0));
  return (
    <div className="rp-prog" aria-hidden="true">
      <i style={{ transform: `scaleX(${permille / 1000})` }} />
    </div>
  );
}
