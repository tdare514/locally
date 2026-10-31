"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  loadSectionFolds,
  saveCoverSize,
  saveLibraryLayout,
  saveSectionFolded,
  type LibrarySectionKey,
  type SectionFolds,
  type CoverSize,
  type LibraryLayout,
  libraryWidthClass,
} from "../lib/library-view-prefs";
import { useLibraryWidth } from "../lib/use-library-width";
import BulkEditDialog from "./BulkEditDialog";
import LibrarySortMenu from "./LibrarySortMenu";
import AddToCollection from "./AddToCollection";
import LibraryCollections from "./LibraryCollections";
import type { ArtistEntry } from "../lib/artist-index";
import {
  ChevronRightIcon,
  CoverLargeIcon,
  CoverSmallIcon,
  FolderIcon,
  MusicNoteIcon,
  SearchIcon,
} from "./Icons";
import NoCover from "./NoCover";
import ArtistsGrid from "./ArtistsGrid";
import { creditKey, filterArtists, type CatalogEntry } from "../lib/artist-catalog";
import { playerStore } from "../lib/play-queue";
import { targetActions, trackMenuGroups, type TrackMenuEnv } from "../lib/track-menu";
import TrackMenu, { TrackMoreButton, useTrackMenu } from "./TrackMenu";

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
  /** One entry per artist, A to Z, for the Artists view (#288). */
  catalog: CatalogEntry[];
  loading: boolean;
  query: string;
  sort: LibrarySort;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onSelectRelease: (id: string) => void;
  /** Opens an artist's page (#288). */
  onSelectArtist: (key: string) => void;
  onImport: (kind?: ReleaseKind) => void;
  /** Refresh the library after a bulk action. */
  onBulkDone: () => Promise<unknown> | void;
  /** Open the Collections page (#420): the Library's one Collections card. */
  onOpenCollections: () => void;
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
  onSelectArtist,
  onImport,
  onBulkDone,
  onOpenCollections,
  onToast,
  onAmbientCoverChange,
  artistIndex,
  catalog,
}: LibraryViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [layout, setLayout] = useState<LibraryLayout>("list");
  const [coverSize, setCoverSize] = useState<CoverSize>(2);
  const [width] = useLibraryWidth();
  const [folds, setFolds] = useState<SectionFolds>(NO_FOLDS);
  const [focusId, setFocusId] = useState<string | null>(null);
  // The one menu of a release row or cover (#419): Edit and Go to album open its page, Go to artist the main artist's.
  // One identity across renders (#422): AppShell passes new arrows each render, and every row is memoised on this.
  const appRef = useRef({ onToast, onSelectRelease, onSelectArtist, onOpenCollections });
  useLayoutEffect(() => {
    appRef.current = { onToast, onSelectRelease, onSelectArtist, onOpenCollections };
  });
  const menuEnv = useMemo<TrackMenuEnv>(
    () => ({
      toast: (kind, text) => appRef.current.onToast(kind, text),
      openRelease: (id) => appRef.current.onSelectRelease(id),
      openArtist: (name) => appRef.current.onSelectArtist(creditKey(name)),
    }),
    [],
  );
  const [focusArtistKey, setFocusArtistKey] = useState<string | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  // Saved view prefs load after mount so the server and first client render agree.
  useEffect(() => {
    const prefs = loadLibraryViewPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(prefs.layout);
    setCoverSize(prefs.coverSize);
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

  const openCollections = useCallback(() => appRef.current.onOpenCollections(), []);
  // The Collections card resolves its covers against every release, so it redraws only when the library does (#422).
  const collectionsCard = useMemo(
    () => <LibraryCollections releases={releases} onOpen={openCollections} />,
    [releases, openCollections],
  );
  // Memoised (#422): the library re-renders on every scroll step, as the ambient wash follows what is on screen.
  const visible = useMemo(() => filterLibrary(releases, query), [releases, query]);
  const { singles, albums } = useMemo(() => partitionLibrary(visible, sort), [visible, sort]);
  // The ambient wash follows the hovered or focused cover while it is on screen, else the first
  // cover on screen, else the first cover in the library.
  const coverReleases = useMemo(() => [...singles, ...albums].filter((r) => r.coverPath), [singles, albums]);
  const focusRelease =
    coverReleases.find((r) => r.id === focusId && visibleIds.has(r.id)) ??
    coverReleases.find((r) => visibleIds.has(r.id)) ??
    coverReleases[0] ??
    null;
  // The Artists view tints by the hovered artist's front cover, else the first artist's.
  const visibleArtists = useMemo(() => filterArtists(catalog, query), [catalog, query]);
  const focusArtist = visibleArtists.find((a) => a.key === focusArtistKey) ?? visibleArtists[0];
  const artistCover = focusArtist?.covers[0];
  const ambientUrl =
    layout === "artists"
      ? artistCover
        ? coverUrl(artistCover.releaseId, artistCover.updatedAt)
        : null
      : focusRelease
        ? coverUrl(focusRelease.id, focusRelease.updatedAt)
        : null;
  useEffect(() => {
    onAmbientCoverChange(ambientUrl);
  }, [ambientUrl, onAmbientCoverChange]);

  // Track which rows or tiles are on screen in the scrolling pane, so the colour follows scroll.
  const shownIds = useMemo(() => [...singles, ...albums].map((r) => r.id).join(","), [singles, albums]);
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
  const artistsView = layout === "artists";

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
                aria-valuetext={["Compact", "Medium", "Large"][coverSize]}
                onChange={(e) => changeCoverSize(Number(e.target.value) as CoverSize)}
                className="size-slider w-24"
              />
              <CoverLargeIcon className="h-4 w-4" />
            </div>
          )}
          <div role="group" aria-label="Library layout" className="btn-seg btn-seg-3">
            <span aria-hidden className="btn-seg-dot">
              <span />
            </span>
            {(
              [
                { value: "list", label: "List" },
                { value: "covers", label: "Grid" },
                { value: "artists", label: "Artists" },
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

      {selecting && !artistsView ? (
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
                className="btn-danger"
              >
                {busy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
                className="btn-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AddToCollection
                name={`${selectedCount} ${selectedCount === 1 ? "release" : "releases"}`}
                variant="bar"
                disabled={busy || selectedCount === 0}
                getItems={() => selectedReleases.map((r) => ({ kind: "release" as const, releaseId: r.id }))}
                onDone={exitSelecting}
              />
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy || selectedCount === 0}
                className="btn-ink"
              >
                Edit details…
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy || selectedCount === 0}
                className="btn-ink-danger"
              >
                Delete…
              </button>
              <button
                type="button"
                onClick={exitSelecting}
                disabled={busy}
                className="btn-ink"
              >
                Done
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
              placeholder={artistsView ? "Search artists…" : "Search titles, artists, genres…"}
              aria-label="Search library"
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query !== "") {
                  e.preventDefault();
                  onQueryChange("");
                }
              }}
              className="min-h-11 w-full rounded-full bg-elevated pl-11 pr-4 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          {!artistsView && <LibrarySortMenu value={sort} onChange={onSortChange} />}
          {!IS_DEMO && !artistsView && (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="btn-ink"
            >
              Select
            </button>
          )}
        </div>
      )}

      {artistsView && visibleArtists.length > 0 && (
        <ArtistsGrid entries={visibleArtists} onOpenArtist={onSelectArtist} onFocusArtist={setFocusArtistKey} />
      )}

      {artistsView && visibleArtists.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-text-muted">{searching ? `No artists match “${query.trim()}”.` : "No artists yet."}</p>
          {searching && (
            <button type="button" onClick={() => onQueryChange("")} className="btn-ink mt-2">
              Clear search
            </button>
          )}
        </div>
      )}

      {!artistsView && searching && visible.length === 0 && (
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
            Clear search
          </button>
        </div>
      )}

      {!artistsView && collectionsCard}

      {!artistsView && singles.length > 0 && (
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
          menuEnv={menuEnv}
        />
      )}

      {!artistsView && singles.length > 0 && albums.length > 0 && (
        <div
          className="border-t border-dashed border-border-dashed"
          aria-hidden="true"
        />
      )}

      {!artistsView && albums.length > 0 && (
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
          menuEnv={menuEnv}
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
  /** How the one release menu (#419) reaches the app. Without it the rows have no menu. */
  menuEnv?: TrackMenuEnv;
}

/** The release menu's groups for a row (#419): the whole release, in play order. None while selecting, or without `menuEnv`. */
function releaseMenuGroups(release: Release, env: TrackMenuEnv | undefined, selecting: boolean) {
  return env && !selecting ? trackMenuGroups(targetActions({ release }, env, playerStore, IS_DEMO)) : [];
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

const addedDateFormats = new Map<string | undefined, Intl.DateTimeFormat>();

/** "Feb 6, 2026" style date in the user's locale. One formatter per locale (#422): building one is the slow part. */
export function formatAddedDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let format = addedDateFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    addedDateFormats.set(locale, format);
  }
  return format.format(d);
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
        className="group flex items-baseline gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
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
  menuEnv,
}: SectionProps) {
  const menu = useTrackMenu();
  const handlers = useRowHandlers(onSelectRelease, onToggle, onFocusRelease);
  const openRelease = menu.open ? releases.find((r) => r.id === menu.open?.key) : undefined;
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
          {releases.map((r, index) => (
            <ListRow
              key={r.id}
              release={r}
              first={index === 0}
              selecting={selecting}
              isSelected={selecting && r.adopted !== true && selected.has(r.id)}
              disabled={disabled}
              menuEnv={menuEnv}
              menuExpanded={menu.open?.key === r.id}
              rowProps={menu.rowProps}
              onOpenMenu={menu.toggleFrom}
              handlers={handlers}
            />
          ))}
        </ul>
        {menu.open && openRelease && (
          <TrackMenu
            label={`Actions for ${openRelease.title || shownArtist(openRelease)}`}
            at={menu.open.at}
            opener={menu.open.opener}
            groups={releaseMenuGroups(openRelease, menuEnv, selecting)}
            onClose={menu.close}
          />
        )}
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
  menuEnv,
}: SectionProps) {
  const menu = useTrackMenu();
  const handlers = useRowHandlers(onSelectRelease, onToggle, onFocusRelease);
  const openRelease = menu.open ? releases.find((r) => r.id === menu.open?.key) : undefined;
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
          {releases.map((r) => (
            <CoverTile
              key={r.id}
              release={r}
              coverSize={coverSize}
              selecting={selecting}
              isSelected={selecting && r.adopted !== true && selected.has(r.id)}
              disabled={disabled}
              menuEnv={menuEnv}
              menuExpanded={menu.open?.key === r.id}
              rowProps={menu.rowProps}
              onOpenMenu={menu.toggleFrom}
              handlers={handlers}
            />
          ))}
          </div>
          {menu.open && openRelease && (
            <TrackMenu
              label={`Actions for ${openRelease.title || shownArtist(openRelease)}`}
              at={menu.open.at}
              opener={menu.open.opener}
              groups={releaseMenuGroups(openRelease, menuEnv, selecting)}
              onClose={menu.close}
            />
          )}
        </>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  release: Release;
  selecting: boolean;
  isSelected: boolean;
  disabled: boolean;
  menuEnv?: TrackMenuEnv;
  menuExpanded: boolean;
  rowProps: ReturnType<typeof useTrackMenu>["rowProps"];
  onOpenMenu: ReturnType<typeof useTrackMenu>["toggleFrom"];
  handlers: RowHandlers;
}

interface RowHandlers {
  select: (id: string) => void;
  toggle: (id: string) => void;
  focus: (id: string) => void;
}

/** A section's row callbacks with one identity across renders (#422): every scroll step re-renders the library (the
 * ambient wash follows what is on screen), and rows memoised on stable props skip it. The latest callbacks are read
 * at call time. */
function useRowHandlers(
  onSelectRelease: (id: string) => void,
  onToggle: (id: string) => void,
  onFocusRelease: (id: string) => void,
): RowHandlers {
  const latest = useRef({ onSelectRelease, onToggle, onFocusRelease });
  useLayoutEffect(() => {
    latest.current = { onSelectRelease, onToggle, onFocusRelease };
  });
  return useMemo(
    () => ({
      select: (id) => latest.current.onSelectRelease(id),
      toggle: (id) => latest.current.onToggle(id),
      focus: (id) => latest.current.onFocusRelease(id),
    }),
    [],
  );
}

/** One list row (#422: memoised, so it redraws only when its own release, selection, or menu state changes). */
const ListRow = memo(function ListRow({
  release,
  first,
  selecting,
  isSelected,
  disabled,
  menuEnv,
  menuExpanded,
  rowProps,
  onOpenMenu,
  handlers,
}: RowProps & { first: boolean }) {
  const locked = selecting && release.adopted === true;
  const artistShown = shownArtist(release);
  const groups = releaseMenuGroups(release, menuEnv, selecting);
  return (
    <li className="group/track relative" {...(groups.length > 0 ? rowProps(release.id) : {})}>
      {!first && (
        <div className="h-px bg-white/[0.06]" aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={() => {
          if (locked) return;
          if (selecting) handlers.toggle(release.id);
          else handlers.select(release.id);
        }}
        onMouseEnter={() => handlers.focus(release.id)}
        onFocus={() => handlers.focus(release.id)}
        data-release-id={release.id}
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
          {release.coverPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl(release.id, release.updatedAt)}
              alt=""
              width={56}
              height={56}
              loading="lazy"
              decoding="async"
              className="list-thumb h-14 w-14 shrink-0 rounded object-cover"
            />
          ) : (
            <NoCover className="list-thumb h-14 w-14 shrink-0 rounded" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-text">
                {release.title || artistShown}
              </span>
              {release.adopted && <AdoptedMark />}
            </span>
            <span className="block truncate text-xs text-text-muted">
              {artistShown}
            </span>
          </span>
        </span>
        <span className={`${COL_GENRE} truncate text-xs text-text-muted`}>
          {release.genre ?? ""}
        </span>
        <span className={`${COL_NUMBER} text-xs text-text-muted`}>
          {release.year ?? ""}
        </span>
        <span className={`${COL_NUMBER} text-xs text-text-muted`}>
          {release.tracks.length}
        </span>
        <span className={`${COL_ADDED} text-xs text-text-muted`}>
          {formatAddedDate(release.createdAt)}
        </span>
        {!selecting ? (
          // The More button takes the chevron's place while the row is hovered or has focus.
          <ChevronRightIcon
            className={`h-4 w-4 shrink-0 text-text-dim ${groups.length > 0 ? "group-hover/track:opacity-0 group-focus-within/track:opacity-0" : ""}`}
          />
        ) : (
          <span />
        )}
      </button>
      {groups.length > 0 && (
        // A wrapper places it: `.btn-icon` sets its own `position`, which a utility on the button can't override.
        <span className="absolute right-0 top-1/2 flex -translate-y-1/2">
          <TrackMoreButton
            title={release.title || artistShown}
            expanded={menuExpanded}
            onOpen={(button) => onOpenMenu(button, release.id)}
          />
        </span>
      )}
    </li>
  );
});

/** One cover tile (#422: memoised like `ListRow`). */
const CoverTile = memo(function CoverTile({
  release,
  coverSize,
  selecting,
  isSelected,
  disabled,
  menuEnv,
  menuExpanded,
  rowProps,
  onOpenMenu,
  handlers,
}: RowProps & { coverSize: CoverSize }) {
  const locked = selecting && release.adopted === true;
  const artistShown = shownArtist(release);
  const url = release.coverPath ? coverUrl(release.id, release.updatedAt) : null;
  const groups = releaseMenuGroups(release, menuEnv, selecting);
  return (
    <div className="group/track relative min-w-0" {...(groups.length > 0 ? rowProps(release.id) : {})}>
    <button
      type="button"
      onClick={() => {
        if (locked) return;
        if (selecting) handlers.toggle(release.id);
        else handlers.select(release.id);
      }}
      onMouseEnter={() => handlers.focus(release.id)}
      onFocus={() => handlers.focus(release.id)}
      data-release-id={release.id}
      disabled={selecting && disabled}
      aria-pressed={selecting && !locked ? isSelected : undefined}
      aria-disabled={locked || undefined}
      title={locked ? ADOPTED_NOT_SELECTABLE : undefined}
      className={`shelf-tile block w-full min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60 ${
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
              loading="lazy"
              decoding="async"
              className="h-full w-full rounded-lg object-cover shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]"
            />
          ) : (
            <NoCover className="h-full w-full rounded-lg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]" />
          )}
          {selecting && !locked && (
            <span className="absolute left-2 top-2 rounded-full bg-black/50 p-1">
              <SelectBox checked={isSelected} />
            </span>
          )}
        </div>
      </div>
      <span className={`mt-3 flex min-w-0 items-center gap-1.5 ${groups.length > 0 ? "pr-7" : ""}`}>
        <span
          className={`truncate font-semibold text-text ${
            coverSize === 0 ? "text-xs" : "text-sm"
          }`}
        >
          {release.title || artistShown}
        </span>
        {release.adopted && <AdoptedMark />}
      </span>
      <span className={`block truncate text-xs text-text-muted ${groups.length > 0 ? "pr-7" : ""}`}>
        {libraryRowSubtitle({ ...release, artist: artistShown })}
      </span>
    </button>
    {groups.length > 0 && (
      // At the caption's right end, on the page rather than the artwork (design rule 3: nothing behind an icon
      // button), above the hovered tile (which rises to z-1). The caption keeps 28px clear for the glyph.
      <span className="absolute -bottom-1 -right-2 z-10 flex">
        <TrackMoreButton
          title={release.title || artistShown}
          expanded={menuExpanded}
          onOpen={(button) => onOpenMenu(button, release.id)}
        />
      </span>
    )}
    </div>
  );
});

/** 20 square checkbox shown at the left of a row in selection mode. */
function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
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
          Make an album
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
      <div className="flex h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-lg border border-border bg-elevated">
        {children}
      </div>
      <span className="text-xs text-text-muted">{caption}</span>
    </div>
  );
}
