"use client";

import { useEffect, useRef, useState } from "react";
import type { Release } from "../shared/types";
import { cleanCollectionName, itemKey, type CollectionRecord } from "../shared/collections";
import {
  COLLECTIONS_COPY,
  buildCollectionQueue,
  buildCollectionQueueAt,
  isCurrentRow,
  rowQueuePositions,
  collectionPlaylistGuide,
  collectionRows,
  collectionTotals,
  filterCollections,
  moveAnnouncement,
  moveRow,
  removeAt,
  splitSides,
  trackCountLabel,
  type CollectionRow,
} from "../lib/collections";
import { coverUrl } from "../lib/api-client";
import { formatLength } from "../lib/adopt-review";
import { normalizeSearchText } from "../lib/library-sections";
import { playerStore, usePlayerSelector, usePlayerState } from "../lib/play-queue";
import { nearestSlot } from "../lib/track-order";
import {
  loadSpinningRecord,
  loadViewMode,
  saveSpinningRecord,
  saveViewMode,
  type CollectionsViewMode,
  type SpinningRecord,
} from "../lib/record-player";
import { useCollections } from "./CollectionsContext";
import CollectionSleeve from "./CollectionSleeve";
import { NowPlayingIcon, PauseIcon, PlayIcon, PlusIcon, SearchIcon, XIcon } from "./Icons";
import NewCollectionForm from "./NewCollectionForm";
import NoCover from "./NoCover";
import PlaylistGuide from "./PlaylistGuide";
import RecordPlayerView from "./RecordPlayerView";
import Popover, { MENU_ITEM } from "./Popover";
import { BarConfirm } from "./ReleaseBar";

interface Props {
  releases: Release[];
  /** The collection on show; the first when absent or gone. */
  selectedId?: string;
  onSelect: (id: string) => void;
  /** "Add tracks" on an empty collection: the Library, where every track row can add. */
  onAddTracks: () => void;
}

/**
 * The Collections page (#349, #351): the record player (a wheel, a turntable and the queue) or the List view (the
 * collections on the left, the chosen one's queue on the right), by a switch remembered on this Mac.
 */
export default function CollectionsView({ releases, selectedId, onSelect, onAddTracks }: Props) {
  const api = useCollections();
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);
  const [mode, setMode] = useState<CollectionsViewMode>(() => loadViewMode());
  const [record, setRecord] = useState<SpinningRecord>(() => loadSpinningRecord());
  if (!api) return null;
  const { collections, loaded, failed } = api;
  const selected = collections.find((c) => c.id === selectedId) ?? collections[0] ?? null;
  const shown = filterCollections(collections, query, normalizeSearchText);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4 pr-[calc(var(--tray-size)+0.75rem)] lg:pr-0">
        <div>
          <p className="text-sm font-semibold text-accent">Your music</p>
          <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">Collections</h1>
          {loaded && collections.length > 0 && (
            <div className="rp-switches mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text-muted">
              <Switch
                label="Show as"
                value={mode}
                options={[
                  ["player", "Record player"],
                  ["list", "List"],
                ]}
                onChange={(v) => {
                  setMode(v);
                  saveViewMode(v);
                }}
              />
              <Switch
                label="Spinning record"
                value={record}
                options={[
                  ["picture", "Picture disc"],
                  ["vinyl", "Black vinyl"],
                ]}
                onChange={(v) => {
                  setRecord(v);
                  saveSpinningRecord(v);
                }}
              />
            </div>
          )}
        </div>
        <button type="button" onClick={() => setMaking((m) => !m)} aria-expanded={making} className="btn-ink min-h-11">
          <PlusIcon className="h-4 w-4" />
          <span className="btn-ink-label">New collection</span>
        </button>
      </div>

      {making && (
        <div className="max-w-xl">
          <NewCollectionForm
            onCancel={() => setMaking(false)}
            onCreate={async (name) => {
              const made = await api.create(name);
              if (made) {
                setMaking(false);
                onSelect(made.id);
              }
            }}
          />
        </div>
      )}

      {api.problem && (
        <p role="status" className="text-sm text-text-muted">
          {api.problem}
        </p>
      )}

      {!loaded ? (
        <Placeholders />
      ) : failed && collections.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-text-muted">{COLLECTIONS_COPY.failedToLoad}</p>
          <button type="button" onClick={() => void api.refresh()} className="btn-ink min-h-11">
            <span className="btn-ink-label">Try again</span>
          </button>
        </div>
      ) : collections.length === 0 ? (
        <div className="flex max-w-xl flex-col items-start gap-4 py-8">
          <span aria-hidden className="block size-24 rounded-full border border-border bg-card" />
          <p className="text-lg text-text">{COLLECTIONS_COPY.none}</p>
          {!making && (
            <button type="button" onClick={() => setMaking(true)} className="btn-save">
              New collection
            </button>
          )}
        </div>
      ) : mode === "player" ? (
        <RecordPlayerView
          collections={collections}
          releases={releases}
          selectedId={selectedId}
          record={record}
          onNew={() => setMaking(true)}
          renderQueue={(c) => (
            <QueuePanel
              key={c.id}
              deck
              collection={c}
              releases={releases}
              onGone={(nextId) => nextId && onSelect(nextId)}
              nextId={collections.find((x) => x.id !== c.id)?.id ?? null}
              onAddTracks={onAddTracks}
            />
          )}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <section aria-label="Your collections" className="flex min-w-0 flex-col gap-3">
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
            <ul className="flex flex-col gap-1">
              {shown.map((c) => {
                const totals = collectionTotals(c.items, releases);
                const on = selected?.id === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      aria-current={on ? "true" : undefined}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-[14px] p-2 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent ${
                        on ? "bg-white/[0.09]" : ""
                      }`}
                    >
                      <CollectionSleeve items={c.items} releases={releases} className="size-12" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-text">{c.name}</span>
                        <span className="block truncate text-xs text-text-muted">
                          {trackCountLabel(totals.tracks)}
                          {totals.seconds > 0 && ` · ${formatLength(totals.seconds)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {shown.length === 0 && <p className="text-sm text-text-muted">No collection matches “{query.trim()}”.</p>}
          </section>
          {selected && (
            <QueuePanel
              key={selected.id}
              collection={selected}
              releases={releases}
              onGone={(nextId) => nextId && onSelect(nextId)}
              nextId={collections.find((c) => c.id !== selected.id)?.id ?? null}
              onAddTracks={onAddTracks}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A two-option switch: words, and a dot under the chosen one (the app's `.btn-seg`). */
function Switch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="btn-seg">
      <span aria-hidden className="btn-seg-dot">
        <span />
      </span>
      {options.map(([v, text]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} className="btn-seg-opt min-h-11 px-3">
          {text}
        </button>
      ))}
    </div>
  );
}

/** Quiet placeholders in the final shapes while the store is first read: no spinner. */
function Placeholders() {
  return (
    <div aria-busy="true" aria-label="Loading collections" className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 p-2">
            <span className="size-12 rounded-[8px] bg-card" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-3 w-2/3 rounded bg-card" />
              <span className="h-2.5 w-1/3 rounded bg-card" />
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-[14px] bg-card" />
        ))}
      </div>
    </div>
  );
}

function QueuePanel({
  collection,
  releases,
  nextId,
  onGone,
  onAddTracks,
  deck = false,
}: {
  collection: CollectionRecord;
  releases: Release[];
  nextId: string | null;
  onGone: (nextId: string | null) => void;
  onAddTracks: () => void;
  /** Under the record player's deck (#351): no sleeve (the hovering cover is the picture), the queue as two columns. */
  deck?: boolean;
}) {
  const api = useCollections()!;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(collection.name);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  const context = usePlayerSelector((s) => (s.queue ? `${s.queue.context.kind}:${s.queue.context.id}` : null));
  const playing = usePlayerSelector((s) => s.playing);

  const rows = collectionRows(collection.items, releases);
  const totals = collectionTotals(collection.items, releases);
  const guide = collectionPlaylistGuide(collection.items, releases);
  const queueOfThis = context === `collection:${collection.id}`;
  const canPlay = buildCollectionQueue(collection, releases) !== null;

  function play() {
    if (queueOfThis) {
      playerStore.toggle();
      return;
    }
    const queue = buildCollectionQueue(collection, releases);
    if (queue) playerStore.start(queue);
  }

  function commitName() {
    const clean = cleanCollectionName(name);
    if (!clean) {
      setName(collection.name);
      return;
    }
    if (clean !== collection.name) void api.save(collection.id, { name: clean });
    setName(clean);
  }

  const empty = collection.items.length === 0;
  return (
    <section aria-label={collection.name} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        {!deck && <CollectionSleeve items={collection.items} releases={releases} className="size-24" />}
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              value={name}
              aria-label="Collection name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitName();
                }
              }}
              className="min-h-11 w-full rounded-[12px] bg-elevated px-3 text-2xl font-bold tracking-[-0.02em] text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          ) : (
            <h2 className={`truncate font-bold tracking-[-0.02em] text-text ${deck ? "text-xl" : "text-2xl"}`}>{collection.name}</h2>
          )}
          <p className="mt-1 text-sm text-text-muted">
            {trackCountLabel(totals.tracks)}
            {totals.seconds > 0 && ` · ${formatLength(totals.seconds)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} disabled={!canPlay} className="btn-save btn-save-lit min-h-11">
            {queueOfThis && playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (editing) commitName();
              setEditing((e) => !e);
              setConfirming(false);
            }}
            aria-pressed={editing}
            className="btn-ink min-h-11"
          >
            <span className="btn-ink-label">{editing ? "Done" : "Edit collection"}</span>
          </button>
        </div>
      </div>

      {!empty && !canPlay && <p className="text-sm text-text-muted">{COLLECTIONS_COPY.noneHere}</p>}

      {editing && (
        <div className="flex flex-wrap items-center gap-3">
          {confirming ? (
            <BarConfirm
              message={`Delete “${collection.name}”? The tracks stay in your library.`}
              onCancel={() => {
                setConfirming(false);
                deleteOpener.current?.focus();
              }}
            >
              <button
                type="button"
                className="btn-ink-danger min-h-11"
                onClick={async () => {
                  if (await api.remove(collection.id)) onGone(nextId);
                }}
              >
                <span className="btn-ink-label">Delete collection</span>
              </button>
            </BarConfirm>
          ) : (
            <button ref={deleteOpener} type="button" onClick={() => setConfirming(true)} className="btn-ink-danger min-h-11">
              <span className="btn-ink-label">Delete collection…</span>
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-start gap-3 rounded-[14px] border border-dashed border-border-dashed p-6">
          <p className="text-text-muted">{COLLECTIONS_COPY.emptyQueue}</p>
          <button type="button" onClick={onAddTracks} className="btn-ink min-h-11">
            <span className="btn-ink-label">Add tracks</span>
          </button>
        </div>
      ) : editing ? (
        <EditList collection={collection} rows={rows} />
      ) : (
        <Queue collection={collection} rows={rows} releases={releases} playing={queueOfThis && playing} sides={deck} />
      )}

      {!empty && !editing && (
        <PlaylistGuide
          name={collection.name}
          trackTitles={guide.tracks.map((t) => t.title)}
          unavailable={guide.tracks.length === 0 ? COLLECTIONS_COPY.nothingToAdd : null}
          note={guide.leftOut > 0 ? COLLECTIONS_COPY.leftOutOfGuide(guide.leftOut, "Mac") : null}
        />
      )}
    </section>
  );
}

interface Entry {
  key: string;
  release: Release;
  trackId: string;
  title: string;
  durationSec: number | null;
  playable: boolean;
  /** Position in the collection's built queue; null when the file is missing. */
  position: number | null;
}

function Queue({
  collection,
  rows,
  releases,
  playing,
  sides = false,
}: {
  collection: CollectionRecord;
  rows: CollectionRow[];
  releases: Release[];
  playing: boolean;
  /** Side A and Side B next to each other (the record player's queue) instead of one under the other. */
  sides?: boolean;
}) {
  const playerQueue = usePlayerState().queue;
  const positions = rowQueuePositions(rows);
  const entries: Entry[] = rows.flatMap((row, r) =>
    row.tracks.map((t, i) => ({
      position: positions[r][i],
      key: `${row.index}/${t.id}`,
      release: row.release,
      trackId: t.id,
      title: t.title.trim() || "Untitled",
      durationSec: t.durationSec,
      playable: !t.missing,
    })),
  );
  const { a, b } = splitSides(entries);
  function playFrom(e: Entry) {
    if (isCurrentRow(playerQueue, collection.id, e.position, { releaseId: e.release.id, trackId: e.trackId })) {
      playerStore.toggle();
      return;
    }
    const queue = e.position === null ? null : buildCollectionQueueAt(collection, releases, e.position);
    if (queue) playerStore.start(queue);
  }
  const side = (label: string, list: Entry[]) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <h3 className="px-2 pb-1 pt-3 text-sm font-medium text-text-muted">{label}</h3>
        <ol className="flex flex-col">
          {list.map((e) => {
            const isCurrent = isCurrentRow(playerQueue, collection.id, e.position, { releaseId: e.release.id, trackId: e.trackId });
            return (
              <li key={e.key}>
                <button
                  type="button"
                  disabled={!e.playable}
                  onClick={() => playFrom(e)}
                  aria-label={`${isCurrent && playing ? "Pause" : "Play"} ${e.title}${e.playable ? "" : ", file missing"}`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-[14px] p-2 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="relative block size-10 shrink-0 overflow-hidden rounded-[6px] bg-card">
                    {e.release.coverPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverUrl(e.release.id, e.release.updatedAt)} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <NoCover className="size-full" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[15px] font-semibold ${isCurrent ? "text-accent" : "text-text"}`}>{e.title}</span>
                    <span className="block truncate text-[13px] text-text-muted">{e.release.artist}</span>
                  </span>
                  {isCurrent && (playing ? <PauseIcon className="size-4 text-accent" /> : <NowPlayingIcon className="size-4 text-accent" />)}
                  {!isCurrent && e.playable && <PlayIcon className="size-4 text-text-dim" />}
                  <span className="w-12 shrink-0 text-right text-sm tabular-nums text-text-muted">
                    {e.playable ? (e.durationSec !== null ? formatLength(e.durationSec) : "") : "Missing"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    );
  if (entries.length === 0) return null;
  return (
    <div className={sides ? "grid gap-x-10 md:grid-cols-2" : "flex flex-col"}>
      {side("Side A", a)}
      {side("Side B", b)}
    </div>
  );
}

/** "Edit collection": rename (in the header), drag by the grip, Option-Up / Option-Down, a menu with Move up / Move down / Remove. */
function EditList({ collection, rows }: { collection: CollectionRecord; rows: CollectionRow[] }) {
  const api = useCollections()!;
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusKey = useRef<string | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  });
  const rowsRef = useRef({ rows, collection });
  useEffect(() => {
    rowsRef.current = { rows, collection };
  });

  // After a move the row keeps focus (it is the same element, re-ordered).
  useEffect(() => {
    if (!focusKey.current) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(focusKey.current)}"]`);
    el?.focus();
    focusKey.current = null;
  });

  function move(from: number, to: number, key: string) {
    if (to < 0 || to >= rows.length || from === to) return;
    const items = moveRow(collection.items, rows, from, to);
    focusKey.current = key;
    setAnnouncement(moveAnnouncement(to + 1, rows.length));
    void api.save(collection.id, { items });
  }

  function startDrag(e: React.PointerEvent<HTMLButtonElement>, from: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ from, over: from });
    const onMove = (ev: PointerEvent) => {
      const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? []);
      const centers = els.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const over = nearestSlot(centers, ev.clientY);
      setDrag((d) => (d ? { ...d, over } : d));
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      const d = dragRef.current;
      setDrag(null);
      if (commit && d && d.from !== d.over) {
        const { rows: r, collection: c } = rowsRef.current;
        const key = itemKey(r[d.from].item);
        focusKey.current = key;
        setAnnouncement(moveAnnouncement(d.over + 1, r.length));
        void api.save(c.id, { items: moveRow(c.items, r, d.from, d.over) });
      }
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-dim">
        Drag a row by its grip, or focus a row and press Option-Up or Option-Down. Each row&rsquo;s menu has Move up and Move down too.
      </p>
      <ol ref={listRef} className="flex flex-col gap-1">
        {rows.map((row, i) => {
          const key = itemKey(row.item)!;
          const title = row.item.kind === "release" ? row.release.title : (row.tracks[0]?.title.trim() || "Untitled");
          const sub =
            row.item.kind === "release"
              ? `Release · ${trackCountLabel(row.tracks.length)} · ${row.release.artist}`
              : `Track · ${row.release.artist}`;
          const menuOpen = menuFor === key;
          return (
            <li
              key={key}
              data-row-key={key}
              tabIndex={0}
              aria-label={`${title}, ${i + 1} of ${rows.length}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || !e.altKey) return;
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, i + (e.key === "ArrowUp" ? -1 : 1), key);
                }
              }}
              className={`flex min-h-14 items-center gap-2 rounded-[14px] p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                drag?.from === i ? "opacity-50" : ""
              } ${drag && drag.over === i && drag.from !== i ? (drag.over < drag.from ? "border-t-2 border-accent" : "border-b-2 border-accent") : ""}`}
            >
              <button
                type="button"
                aria-label={`Drag ${title}`}
                onPointerDown={(e) => startDrag(e, i)}
                className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                  <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                  <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </button>
              <span className="relative block size-10 shrink-0 overflow-hidden rounded-[6px] bg-card">
                {row.release.coverPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl(row.release.id, row.release.updatedAt)} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <NoCover className="size-full" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-text">{title}</span>
                <span className="block truncate text-[13px] text-text-muted">{sub}</span>
              </span>
              <RowMenu
                title={title}
                open={menuOpen}
                onOpenChange={(o) => setMenuFor(o ? key : null)}
                canUp={i > 0}
                canDown={i < rows.length - 1}
                onUp={() => move(i, i - 1, key)}
                onDown={() => move(i, i + 1, key)}
                onRemove={() => {
                  setAnnouncement(`Removed ${title}`);
                  void api.save(collection.id, { items: removeAt(collection.items, row.index) });
                }}
              />
              <button
                type="button"
                aria-label={`Remove ${title}`}
                onClick={() => {
                  setAnnouncement(`Removed ${title}`);
                  void api.save(collection.id, { items: removeAt(collection.items, row.index) });
                }}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"
              >
                <XIcon className="size-4" />
              </button>
            </li>
          );
        })}
      </ol>
      {rows.length < collection.items.length && (
        <p className="text-xs text-text-dim">Some items aren&rsquo;t in this library. They stay in the collection.</p>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

/** A row's "..." menu in the edit list: Move up, Move down, Remove from collection. */
function RowMenu({
  title,
  open,
  onOpenChange,
  canUp,
  canDown,
  onUp,
  onDown,
  onRemove,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const choose = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        ref={buttonRef}
        aria-label={`Options for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex size-11 items-center justify-center rounded-md text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      <Popover
        open={open}
        anchorRef={buttonRef}
        onClose={(returnFocus) => {
          onOpenChange(false);
          if (returnFocus) buttonRef.current?.focus();
        }}
        label={`Options for ${title}`}
        width={220}
      >
        <button type="button" role="menuitem" disabled={!canUp} onClick={choose(onUp)} className={MENU_ITEM}>
          Move up
        </button>
        <button type="button" role="menuitem" disabled={!canDown} onClick={choose(onDown)} className={MENU_ITEM}>
          Move down
        </button>
        <button type="button" role="menuitem" onClick={choose(onRemove)} className={MENU_ITEM}>
          Remove from collection
        </button>
      </Popover>
    </div>
  );
}
