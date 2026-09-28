"use client";

import type { ReactNode } from "react";
import type { Release, ReleaseKind } from "../shared/types";
import { coverUrl } from "../lib/api-client";
import {
  libraryRowSubtitle,
  partitionLibrary,
} from "../lib/library-sections";
import { ChevronRightIcon, MusicNoteIcon } from "./Icons";

interface LibraryViewProps {
  releases: Release[];
  loading: boolean;
  onSelectRelease: (id: string) => void;
  onImport: (kind?: ReleaseKind) => void;
}

/**
 * Mac library home (issue #7): mirrors iOS LibraryView — onboarding empty
 * state when there are no releases; otherwise YOUR COLLECTION / All music
 * with Singles then Albums sections and counts.
 */
export default function LibraryView({
  releases,
  loading,
  onSelectRelease,
  onImport,
}: LibraryViewProps) {
  if (loading) {
    return <p className="text-text-muted">Loading…</p>;
  }

  if (releases.length === 0) {
    return <LibraryEmptyState onImport={onImport} />;
  }

  const { singles, albums, totalTracks } = partitionLibrary(releases);

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

      {singles.length > 0 && (
        <LibrarySection
          label="Singles"
          count={singles.length}
          releases={singles}
          onSelectRelease={onSelectRelease}
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
    </div>
  );
}

function LibrarySection({
  label,
  count,
  releases,
  onSelectRelease,
}: {
  label: string;
  count: number;
  releases: Release[];
  onSelectRelease: (id: string) => void;
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
        {releases.map((r, index) => (
          <li key={r.id}>
            {index > 0 && <div className="h-px bg-border" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => onSelectRelease(r.id)}
              className="flex min-h-[78px] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-row-hover"
            >
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
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-dim" />
            </button>
          </li>
        ))}
      </ul>
    </section>
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
