"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Release, ReleaseKind } from "../shared/types";
import { coverUrl, deleteRelease, updateRelease } from "../lib/api-client";
import { IS_DEMO } from "../lib/demo";
import { UNKNOWN_ARTIST } from "../shared/adopt";
import PlaysPromptCard from "./PlaysPromptCard";
import {
  bulkDetailsPatch,
  bulkSummary,
  runBulk,
  type BulkDetails,
} from "../lib/library-bulk";
import {
  LIBRARY_SORT_OPTIONS,
  filterLibrary,
  libraryRowSubtitle,
  partitionLibrary,
  type LibrarySort,
} from "../lib/library-sections";
import {
  COVER_GRID_GAP_PX,
  COVER_TILE_MIN_PX,
  NO_FOLDS,
  isSectionOpen,
  loadLibraryViewPrefs,
  loadLibraryWidth,
  loadSectionFolds,
  saveCoverSize,
  saveLibraryLayout,
  saveSectionFolded,
  type LibrarySectionKey,
  type SectionFolds,
  type CoverSize,
  type LibraryLayout,
  type LibraryWidth,
  libraryWidthClass,
} from "../lib/library-view-prefs";
import BulkEditDialog from "./BulkEditDialog";
import type { ArtistEntry } from "../lib/artist-index";
import {
  ChevronRightIcon,
  CoverLargeIcon,
  CoverSmallIcon,
  FolderIcon,
  MusicNoteIcon,
  SearchIcon,
} from "./Icons";
import HouseSleeve from "./HouseSleeve";

const ADOPTED_LABEL = "In your Spotify folder";
const ADOPTED_NOT_SELECTABLE = "Releases from your Spotify folder can't be selected. Remove one from its own page.";

/** The artist as shown: a release added from a Spotify folder with no artist tag reads "Unknown artist". Never stored. */
function shownArtist(r: Release): string {
  return r.adopted && r.artist.trim() === "" ? UNKNOWN_ARTIST : r.artist;
}

/** The quiet folder glyph after the title of a release added from a Spotify folder (#249). */
function AdoptedMark() {
  return (
    <span role="img" aria-label={ADOPTED_LABEL} title={ADOPTED_LABEL} className="flex shrink-0 text-text-dim">
      <FolderIcon className="size-3.5" />
    </span>
  );
}

interface LibraryViewProps {
  releases: Release[];
  /** Every artist in the library, for the bulk edit's Artist field (#287). */
  artistIndex: ArtistEntry[];
  loading: boolean;
  query: string;
  sort: LibrarySort;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onSelectRelease: (id: string) => void;
  onImport: (kind?: ReleaseKind) => void;
  /** Refresh the library after a bulk action. */
  onBulkDone: () => Promise<unknown> | void;
  onToast: (kind: "success" | "error", text: string) => void;
  /** The cover that should tint the ambient space, or null when there is none. */
  onAmbientCoverChange: (url: string | null) => void;
}

/**
 * Mac library home (issue #7): mirrors iOS LibraryView — onboarding empty
 * state when there are no releases; otherwise Your collection / All music
 * with Singles then Albums sections and counts.
 */
export default function LibraryView({
  releases,
  loading,
  query,
  sort,
  onQueryChange,
  onSortChange,
  onSelectRelease,
  onImport,
  onBulkDone,
  onToast,
  onAmbientCoverChange,
  artistIndex,
}: LibraryViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<LibraryLayout>("list");
  const [coverSize, setCoverSize] = useState<CoverSize>(1);
  const [width, setWidth] = useState<LibraryWidth>("full");
  const [folds, setFolds] = useState<SectionFolds>(NO_FOLDS);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  // Saved view prefs load after mount so the server and first client render agree.
  useEffect(() => {
    const prefs = loadLibraryViewPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(prefs.layout);
    setCoverSize(prefs.coverSize);
    setWidth(loadLibraryWidth());
    setFolds(loadSectionFolds());
  }, []);

  function toggleFold(key: LibrarySectionKey) {
    const next = !folds[key];
    setFolds({ ...folds, [key]: next });
    saveSectionFolded(key, next);
  }

  function changeLayout(next: LibraryLayout) {
    setLayout(next);
    saveLibraryLayout(next);
  }

  function changeCoverSize(next: CoverSize) {
    setCoverSize(next);
    saveCoverSize(next);
  }

  const visible = filterLibrary(releases, query);
  const { singles, albums } = partitionLibrary(visible, sort);
  // The ambient wash follows the hovered or focused cover while it is on screen, else the first
  // cover on screen, else the first cover in the library.
  const coverReleases = [...singles, ...albums].filter((r) => r.coverPath);
  const focusRelease =
    coverReleases.find((r) => r.id === focusId && visibleIds.has(r.id)) ??
    coverReleases.find((r) => visibleIds.has(r.id)) ??
    coverReleases[0] ??
    null;
  const ambientUrl = focusRelease
    ? coverUrl(focusRelease.id, focusRelease.updatedAt)
    : null;
  useEffect(() => {
    onAmbientCoverChange(ambientUrl);
  }, [ambientUrl, onAmbientCoverChange]);

  // Track which rows or tiles are on screen in the scrolling pane, so the colour follows scroll.
  const shownIds = [...singles, ...albums].map((r) => r.id).join(",");
  // Folding unmounts a section's rows and unfolding mounts new ones, so observation is rebuilt on every fold change.
  const singlesOpen = isSectionOpen(folds.singles, query);
  const albumsOpen = isSectionOpen(folds.albums, query);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.releaseId;
          if (!id) continue;
          if (entry.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        setVisibleIds(new Set(inView));
      },
      { root: root.closest("main"), threshold: 0.4 },
    );
    root
      .querySelectorAll("[data-release-id]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [layout, shownIds, loading, coverSize, singlesOpen, albumsOpen]);

  // Cmd+F / Ctrl+F focuses the library search instead of the browser's find bar.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
        searchRef.current.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Escape leaves selection mode (not while a dialog is open or an action is running).
  useEffect(() => {
    if (!selecting || editing || busy) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setSelecting(false);
        setSelected(new Set());
        setConfirmingDelete(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, editing, busy]);

  if (loading) {
    return <p className="text-text-muted">Loading…</p>;
  }

  if (releases.length === 0) {
    return <LibraryEmptyState onImport={onImport} onToast={onToast} />;
  }

  const totalTracks = releases.reduce((n, r) => n + r.tracks.length, 0);
  const searching = query.trim() !== "";
  const selectedReleases = releases.filter((r) => selected.has(r.id));
  const selectedCount = selectedReleases.length;
  // Releases from a Spotify folder can't be edited or deleted here, so they are never selectable.
  const selectableVisible = visible.filter((r) => !r.adopted);
  const hasAdopted = releases.some((r) => r.adopted);
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((r) => selected.has(r.id));

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setConfirmingDelete(false);
  }

  function toggleRelease(id: string) {
    if (busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of selectableVisible) {
        if (allVisibleSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  async function handleBulkDelete() {
    if (busy || selectedCount === 0) return;
    setBusy(true);
    try {
      const total = selectedReleases.length;
      const outcome = await runBulk(selectedReleases, (r) =>
        deleteRelease(r.id),
      );
      const summary = bulkSummary("Deleted", outcome, total);
      onToast(summary.kind, summary.text);
      await onBulkDone();
      // Keep only the releases that failed to delete selected.
      const remaining = new Set(outcome.failed.map((f) => f.id));
      setSelected(remaining);
      setConfirmingDelete(false);
      if (remaining.size === 0) setSelecting(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkEdit(details: BulkDetails) {
    const patch = bulkDetailsPatch(details);
    if (!patch || busy) return;
    setBusy(true);
    try {
      const total = selectedReleases.length;
      const outcome = await runBulk(selectedReleases, (r) =>
        updateRelease(r.id, patch),
      );
      const summary = bulkSummary("Updated", outcome, total);
      onToast(summary.kind, summary.text);
      // Close before the refresh: the list shows "Loading…" while it reloads.
      setEditing(false);
      await onBulkDone();
    } finally {
      setBusy(false);
    }
  }

  const SectionComponent = layout === "covers" ? CoverSection : LibrarySection;

  return (
    <div
      ref={rootRef}
      className={`flex flex-col gap-8 pb-16 ${libraryWidthClass(width)}`}
    >
      <div className="flex items-baseline justify-between gap-4 pr-[calc(var(--tray-size)+0.75rem)] lg:pr-0">
        <div>
          <p className="text-sm font-semibold text-accent">
            Your collection
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">
            All music
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <p className="text-sm text-text-muted">
            {totalTracks} track{totalTracks === 1 ? "" : "s"}
          </p>
          {layout === "covers" && (
            <div className="flex items-center gap-2 text-text-dim">
              <CoverSmallIcon className="h-4 w-4" />
              <input
                type="range"
                min={0}
                max={2}
                step={1}
                value={coverSize}
                aria-label="Cover size"
                onChange={(e) => changeCoverSize(Number(e.target.value) as CoverSize)}
                className="w-[88px] accent-accent"
              />
              <CoverLargeIcon className="h-4 w-4" />
            </div>
          )}
          <div role="group" aria-label="Library layout" className="btn-seg">
            <span aria-hidden className="btn-seg-dot">
              <span />
            </span>
            {(
              [
                { value: "list", label: "List" },
                { value: "covers", label: "Grid" },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => changeLayout(value)}
                aria-pressed={layout === value}
                className="btn-seg-opt"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PlaysPromptCard onToast={onToast} />

      {selecting ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-4">
            {selectedCount === 0 ? (
              <span className="text-sm text-text-muted">Select releases</span>
            ) : (
              <span className="text-sm font-semibold text-text">
                {selectedCount} selected
              </span>
            )}
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={busy || selectableVisible.length === 0}
              className="text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
            >
              {allVisibleSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-text-muted">
                Delete {selectedCount} release{selectedCount === 1 ? "" : "s"}?
                Their files are removed from the library folder and Spotify
                loses them.
              </span>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={busy}
                className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="btn-ink"
              >
                <span className="btn-ink-label">Cancel</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy || selectedCount === 0}
                className="btn-ink"
              >
                <span className="btn-ink-label">Edit details…</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy || selectedCount === 0}
                className="btn-ink-danger"
              >
                <span className="btn-ink-label">Delete…</span>
              </button>
              <button
                type="button"
                onClick={exitSelecting}
                disabled={busy}
                className="btn-ink"
              >
                <span className="btn-ink-label">Done</span>
              </button>
            </div>
          )}
          {hasAdopted && <p className="basis-full text-xs text-text-dim">{ADOPTED_NOT_SELECTABLE}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search titles, artists, genres…"
              aria-label="Search library"
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query !== "") {
                  e.preventDefault();
                  onQueryChange("");
                }
              }}
              className="w-full rounded-md bg-elevated py-3 pl-11 pr-4 text-sm text-text outline-none placeholder:text-text-muted/60 focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="relative shrink-0">
            <select
              aria-label="Sort library"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as LibrarySort)}
              className="appearance-none rounded-md bg-elevated py-3 pl-4 pr-10 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
            >
              {LIBRARY_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronRightIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-text-muted" />
          </div>
          {!IS_DEMO && (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="btn-ink"
            >
              <span className="btn-ink-label">Select</span>
            </button>
          )}
        </div>
      )}

      {searching && visible.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-text-muted">No matches for “{query.trim()}”</p>
          <p className="text-xs text-text-dim">
            Try another title, artist, genre, or year.
          </p>
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="btn-ink mt-2"
          >
            <span className="btn-ink-label">Clear search</span>
          </button>
        </div>
      )}

      {singles.length > 0 && (
        <SectionComponent
          label="Singles"
          bodyId="library-singles"
          open={singlesOpen}
          onToggleOpen={() => toggleFold("singles")}
          count={singles.length}
          releases={singles}
          onSelectRelease={onSelectRelease}
          selecting={selecting}
          selected={selected}
          disabled={busy}
          onToggle={toggleRelease}
          coverSize={coverSize}
          onFocusRelease={setFocusId}
        />
      )}

      {singles.length > 0 && albums.length > 0 && (
        <div
          className="border-t border-dashed border-border-dashed"
          aria-hidden="true"
        />
      )}

      {albums.length > 0 && (
        <SectionComponent
          label="Albums"
          bodyId="library-albums"
          open={albumsOpen}
          onToggleOpen={() => toggleFold("albums")}
          count={albums.length}
          releases={albums}
          onSelectRelease={onSelectRelease}
          selecting={selecting}
          selected={selected}
          disabled={busy}
          onToggle={toggleRelease}
          coverSize={coverSize}
          onFocusRelease={setFocusId}
        />
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => onImport()}
          disabled={IS_DEMO}
          title={IS_DEMO ? "Not available in the demo" : undefined}
          className="btn-save"
        >
          Add a song
        </button>
      </div>

      <BulkEditDialog
        open={editing}
        count={selectedCount}
        busy={busy}
        onCancel={() => {
          if (!busy) setEditing(false);
        }}
        onApply={handleBulkEdit}
        artistIndex={artistIndex}
      />
    </div>
  );
}

interface SectionProps {
  label: string;
  /** Id of the section body, which the header button controls. */
  bodyId: string;
  open: boolean;
  onToggleOpen: () => void;
  count: number;
  releases: Release[];
  onSelectRelease: (id: string) => void;
  selecting: boolean;
  selected: Set<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
  coverSize: CoverSize;
  onFocusRelease: (id: string) => void;
}

/** Shared grid for the list header and every row. Columns drop as the section narrows:
 * Added under 820px, Genre under 680px, Year and Tracks under 520px. */
const LIST_GRID =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_16px] " +
  "@[520px]:grid-cols-[minmax(0,1fr)_56px_56px_16px] " +
  "@[680px]:grid-cols-[minmax(0,1fr)_minmax(0,180px)_56px_56px_16px] " +
  "@[820px]:grid-cols-[minmax(0,1fr)_minmax(0,180px)_56px_56px_144px_16px]";
const COL_GENRE = "hidden @[680px]:block";
const COL_NUMBER = "hidden @[520px]:block text-right tabular-nums";
const COL_ADDED = "hidden @[820px]:block pl-6 tabular-nums";

/** "Feb 6, 2026" style date in the user's locale. */
export function formatAddedDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

/** The Singles or Albums heading as one button: label, count, chevron (#260). The button sits inside
 * the h2 so the heading stays in the outline. */
function SectionHeader({
  label,
  count,
  bodyId,
  open,
  onToggleOpen,
}: Pick<SectionProps, "label" | "count" | "bodyId" | "open" | "onToggleOpen">) {
  return (
    <h2 className="px-1 text-[22px] font-bold tracking-[-0.03em] text-text">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls={bodyId}
        className="group flex items-baseline gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
      >
        <span>{label}</span>
        <span className="text-sm font-normal tracking-normal text-text-dim">{count}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 self-center text-text-dim transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:text-text-muted motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
    </h2>
  );
}

export function LibrarySection({
  label,
  bodyId,
  open,
  onToggleOpen,
  count,
  releases,
  onSelectRelease,
  selecting,
  selected,
  disabled,
  onToggle,
  onFocusRelease,
}: SectionProps) {
  return (
    <section className="@container flex flex-col gap-2">
      <SectionHeader
        label={label}
        count={count}
        bodyId={bodyId}
        open={open}
        onToggleOpen={onToggleOpen}
      />
      <div
        id={bodyId}
        hidden={!open}
        className={open ? "section-fade flex flex-col gap-2" : undefined}
      >
        {open && (
        <>
        {/* Presentational: each row's button already carries the full accessible name. */}
        <div
          aria-hidden="true"
          className={`${LIST_GRID} -mb-1 px-[13px] text-[12px] text-text-dim`}
        >
          <span>Title</span>
          <span className={COL_GENRE}>Genre</span>
          <span className={COL_NUMBER}>Year</span>
          <span className={COL_NUMBER}>Tracks</span>
          <span className={COL_ADDED}>Added</span>
          <span />
        </div>
        <ul className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.04]">
          {releases.map((r, index) => {
            const locked = selecting && r.adopted === true;
            const isSelected = selecting && !locked && selected.has(r.id);
            const artistShown = shownArtist(r);
            return (
              <li key={r.id}>
                {index > 0 && (
                  <div className="h-px bg-white/[0.06]" aria-hidden="true" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (locked) return;
                    if (selecting) onToggle(r.id);
                    else onSelectRelease(r.id);
                  }}
                  onMouseEnter={() => onFocusRelease(r.id)}
                  onFocus={() => onFocusRelease(r.id)}
                  data-release-id={r.id}
                  disabled={selecting && disabled}
                  aria-pressed={selecting && !locked ? isSelected : undefined}
                  aria-disabled={locked || undefined}
                  title={locked ? ADOPTED_NOT_SELECTABLE : undefined}
                  className={`list-row ${LIST_GRID} min-h-[78px] w-full px-3 py-3 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected ? "bg-white/[0.06]" : ""
                  } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {selecting && !locked && <SelectBox checked={isSelected} />}
                    {locked && <span aria-hidden="true" className="size-5 shrink-0" />}
                    {r.coverPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coverUrl(r.id, r.updatedAt)}
                        alt=""
                        className="list-thumb h-14 w-14 shrink-0 rounded object-cover"
                      />
                    ) : r.adopted ? (
                      <HouseSleeve className="list-thumb h-14 w-14 shrink-0 rounded" />
                    ) : (
                      <span className="list-thumb flex h-14 w-14 shrink-0 items-center justify-center rounded bg-elevated text-text-muted">
                        <MusicNoteIcon className="h-5 w-5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-text">
                          {r.title || artistShown}
                        </span>
                        {r.adopted && <AdoptedMark />}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {artistShown}
                      </span>
                    </span>
                  </span>
                  <span className={`${COL_GENRE} truncate text-xs text-text-muted`}>
                    {r.genre ?? ""}
                  </span>
                  <span className={`${COL_NUMBER} text-xs text-text-muted`}>
                    {r.year ?? ""}
                  </span>
                  <span className={`${COL_NUMBER} text-xs text-text-muted`}>
                    {r.tracks.length}
                  </span>
                  <span className={`${COL_ADDED} text-xs text-text-muted`}>
                    {formatAddedDate(r.createdAt)}
                  </span>
                  {!selecting ? (
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-dim" />
                  ) : (
                    <span />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        </>
        )}
      </div>
    </section>
  );
}

/** Cover view section: a grid of bare covers that pop on hover (#112). */
function CoverSection({
  label,
  bodyId,
  open,
  onToggleOpen,
  count,
  releases,
  onSelectRelease,
  selecting,
  selected,
  disabled,
  onToggle,
  coverSize,
  onFocusRelease,
}: SectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        label={label}
        count={count}
        bodyId={bodyId}
        open={open}
        onToggleOpen={onToggleOpen}
      />
      <div
        id={bodyId}
        hidden={!open}
        className={open ? "section-fade" : undefined}
      >
        {open && (
        <>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${COVER_TILE_MIN_PX[coverSize]}px, 1fr))`,
            gap: COVER_GRID_GAP_PX[coverSize],
          }}
        >
          {releases.map((r) => {
            const locked = selecting && r.adopted === true;
            const isSelected = selecting && !locked && selected.has(r.id);
            const artistShown = shownArtist(r);
            const url = r.coverPath ? coverUrl(r.id, r.updatedAt) : null;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (locked) return;
                  if (selecting) onToggle(r.id);
                  else onSelectRelease(r.id);
                }}
                onMouseEnter={() => onFocusRelease(r.id)}
                onFocus={() => onFocusRelease(r.id)}
                data-release-id={r.id}
                disabled={selecting && disabled}
                aria-pressed={selecting && !locked ? isSelected : undefined}
                aria-disabled={locked || undefined}
                title={locked ? ADOPTED_NOT_SELECTABLE : undefined}
                className={`shelf-tile min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                  locked ? "cursor-not-allowed opacity-60" : ""
                }`}
              >
                <div className="relative aspect-square">
                  <div
                    className={`shelf-cover h-full w-full rounded-lg ${
                      isSelected
                        ? "ring-2 ring-accent ring-offset-2 ring-offset-bg"
                        : ""
                    }`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt=""
                        className="h-full w-full rounded-lg object-cover shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]"
                      />
                    ) : r.adopted ? (
                      <HouseSleeve className="h-full w-full rounded-lg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center rounded-lg bg-elevated text-text-muted shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]">
                        <MusicNoteIcon className="h-8 w-8" />
                      </span>
                    )}
                    {selecting && !locked && (
                      <span className="absolute left-2 top-2 rounded-md bg-black/50 p-1">
                        <SelectBox checked={isSelected} />
                      </span>
                    )}
                  </div>
                </div>
                <span className="mt-3 flex min-w-0 items-center gap-1.5">
                  <span
                    className={`truncate font-semibold text-text ${
                      coverSize === 0 ? "text-xs" : "text-sm"
                    }`}
                  >
                    {r.title || artistShown}
                  </span>
                  {r.adopted && <AdoptedMark />}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {libraryRowSubtitle({ ...r, artist: artistShown })}
                </span>
              </button>
            );
          })}
          </div>
        </>
        )}
      </div>
    </section>
  );
}

/** 20 square checkbox shown at the left of a row in selection mode. */
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
        checked ? "border-accent bg-accent" : "border-text-dim"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/** Empty library doubles as onboarding — same copy and diagram as iOS. */
function LibraryEmptyState({
  onImport,
  onToast,
}: {
  onImport: (kind?: ReleaseKind) => void;
  onToast: LibraryViewProps["onToast"];
}) {
  return (
    <div className="mx-auto flex min-h-[min(70vh,640px)] max-w-lg flex-col items-center px-4 pb-8 pt-10 text-center">
      <div className="flex flex-1 flex-col items-center justify-center">
        <EmptyDiagram />
        <p className="mt-9 text-sm font-semibold text-accent">
          Your library
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.02em] text-text">
          Nothing here yet
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-text-muted">
          Songs you add here are tagged with your cover and details, then sent
          into Spotify&apos;s Local Files.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3 pt-10">
        <button
          type="button"
          onClick={() => onImport("single")}
          disabled={IS_DEMO}
          title={IS_DEMO ? "Not available in the demo" : undefined}
          className="btn-save w-full"
        >
          Add your first single
        </button>
        <button
          type="button"
          onClick={() => onImport("album")}
          disabled={IS_DEMO}
          title={IS_DEMO ? "Not available in the demo" : undefined}
          className="btn-ink w-full"
        >
          <span className="btn-ink-label">Make an album</span>
        </button>
      </div>
      <PlaysPromptCard onToast={onToast} className="mt-8" />
    </div>
  );
}

/** Locally tile → accent dots → Spotify tile (note icon, never Spotify's logo). */
function EmptyDiagram() {
  return (
    <div className="flex items-start gap-[18px]" aria-hidden="true">
      <DiagramTile caption="Locally">
        {/* The solid listener mark doubles as the Mac empty-state icon tile
            (docs/design.md); scripts/make-brand-marks.py renders it. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
        <img
          src="/brand/listener-solid.svg"
          alt=""
          className="h-12 w-12"
        />
      </DiagramTile>
      <div className="flex h-[68px] items-center gap-[5px]">
        <span className="h-[5px] w-[5px] rounded-full bg-accent" />
        <span className="h-[5px] w-[5px] rounded-full bg-accent" />
        <span className="h-[5px] w-[5px] rounded-full bg-accent" />
        <ChevronRightIcon className="h-3.5 w-3.5 text-accent" />
      </div>
      <DiagramTile caption="Spotify">
        <MusicNoteIcon className="h-7 w-7 text-text" />
      </DiagramTile>
    </div>
  );
}

function DiagramTile({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-elevated">
        {children}
      </div>
      <span className="text-xs text-text-muted">{caption}</span>
    </div>
  );
}
