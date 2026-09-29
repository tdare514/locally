"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Release, ReleaseKind } from "../shared/types";
import { coverUrl, deleteRelease, updateRelease } from "../lib/api-client";
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
import BulkEditDialog from "./BulkEditDialog";
import { ChevronRightIcon, MusicNoteIcon, SearchIcon } from "./Icons";

interface LibraryViewProps {
  releases: Release[];
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
}

/**
 * Mac library home (issue #7): mirrors iOS LibraryView — onboarding empty
 * state when there are no releases; otherwise YOUR COLLECTION / All music
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
}: LibraryViewProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

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
    return <LibraryEmptyState onImport={onImport} />;
  }

  const totalTracks = releases.reduce((n, r) => n + r.tracks.length, 0);
  const visible = filterLibrary(releases, query);
  const { singles, albums } = partitionLibrary(visible, sort);
  const searching = query.trim() !== "";
  const selectedReleases = releases.filter((r) => selected.has(r.id));
  const selectedCount = selectedReleases.length;
  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.id));

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
      for (const r of visible) {
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

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-8 pb-16">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
            Your collection
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">
            All music
          </h1>
        </div>
        <p className="shrink-0 text-sm text-text-muted">
          {totalTracks} track{totalTracks === 1 ? "" : "s"}
        </p>
      </div>

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
              disabled={busy || visible.length === 0}
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
                className="rounded-full px-4 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy || selectedCount === 0}
                className="rounded-full bg-elevated px-5 py-2 text-sm font-bold text-text transition-colors hover:bg-elevated-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Edit details…
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy || selectedCount === 0}
                className="px-3 py-2 text-sm font-semibold text-danger transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete…
              </button>
              <button
                type="button"
                onClick={exitSelecting}
                disabled={busy}
                className="px-3 py-2 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                Done
              </button>
            </div>
          )}
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
          <button
            type="button"
            onClick={() => setSelecting(true)}
            className="shrink-0 rounded-full bg-elevated px-6 py-3 text-sm font-bold text-text transition-colors hover:bg-elevated-hover active:scale-95"
          >
            Select
          </button>
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
            className="mt-2 rounded-full bg-elevated px-6 py-2 text-sm font-bold text-text transition-colors hover:bg-elevated-hover active:scale-95"
          >
            Clear search
          </button>
        </div>
      )}

      {singles.length > 0 && (
        <LibrarySection
          label="Singles"
          count={singles.length}
          releases={singles}
          onSelectRelease={onSelectRelease}
          selecting={selecting}
          selected={selected}
          disabled={busy}
          onToggle={toggleRelease}
        />
      )}

      {singles.length > 0 && albums.length > 0 && (
        <div
          className="border-t border-dashed border-border-dashed"
          aria-hidden="true"
        />
      )}

      {albums.length > 0 && (
        <LibrarySection
          label="Albums"
          count={albums.length}
          releases={albums}
          onSelectRelease={onSelectRelease}
          selecting={selecting}
          selected={selected}
          disabled={busy}
          onToggle={toggleRelease}
        />
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => onImport()}
          className="rounded-full bg-accent px-8 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95"
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
      />
    </div>
  );
}

function LibrarySection({
  label,
  count,
  releases,
  onSelectRelease,
  selecting,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  count: number;
  releases: Release[];
  onSelectRelease: (id: string) => void;
  selecting: boolean;
  selected: Set<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-[22px] font-bold tracking-[-0.03em] text-text">
          {label}
        </h2>
        <span className="text-sm text-text-dim">{count}</span>
      </div>
      <ul className="overflow-hidden rounded-xl border border-border bg-card">
        {releases.map((r, index) => {
          const isSelected = selecting && selected.has(r.id);
          return (
            <li key={r.id}>
              {index > 0 && (
                <div className="h-px bg-border" aria-hidden="true" />
              )}
              <button
                type="button"
                onClick={() =>
                  selecting ? onToggle(r.id) : onSelectRelease(r.id)
                }
                disabled={selecting && disabled}
                aria-pressed={selecting ? isSelected : undefined}
                className={`flex min-h-[78px] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected ? "bg-row-hover" : ""
                }`}
              >
                {selecting && <SelectBox checked={isSelected} />}
                {r.coverPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverUrl(r.id, r.updatedAt)}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-elevated text-text-muted">
                    <MusicNoteIcon className="h-5 w-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text">
                    {r.title || r.artist}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {libraryRowSubtitle(r)}
                  </span>
                </span>
                {!selecting && (
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-dim" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
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
}: {
  onImport: (kind?: ReleaseKind) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[min(70vh,640px)] max-w-lg flex-col items-center px-4 pb-8 pt-10 text-center">
      <div className="flex flex-1 flex-col items-center justify-center">
        <EmptyDiagram />
        <p className="mt-9 text-xs font-bold uppercase tracking-[0.18em] text-accent">
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
          className="w-full rounded-full bg-accent px-8 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95"
        >
          Add your first single
        </button>
        <button
          type="button"
          onClick={() => onImport("album")}
          className="w-full rounded-full bg-elevated px-8 py-3 text-sm font-bold text-text transition-colors hover:bg-elevated-hover active:scale-95"
        >
          Make an album
        </button>
      </div>
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
