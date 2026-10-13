"use client";

import type { Release } from "../shared/types";
import { coverUrl } from "../lib/api-client";
import {
  filterLibrary,
  partitionLibrary,
  type LibrarySort,
} from "../lib/library-sections";
import type { View } from "./AppShell";
import { LibraryIcon, MusicNoteIcon, PlusIcon, SettingsIcon } from "./Icons";

interface SidebarProps {
  releases: Release[];
  loading: boolean;
  view: View;
  query: string;
  sort: LibrarySort;
  onClearQuery: () => void;
  onSelectRelease: (id: string) => void;
  onLibraryClick: () => void;
  onImportClick: () => void;
  onSettingsClick: () => void;
  signedIn: boolean;
  email: string | null;
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function navItemClass(active: boolean): string {
  return `flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${focusRing} ${
    active ? "bg-white/[0.08] text-text" : "text-text-muted hover:bg-white/[0.06] hover:text-text"
  }`;
}

export default function Sidebar({
  releases,
  loading,
  view,
  query,
  sort,
  onClearQuery,
  onSelectRelease,
  onLibraryClick,
  onImportClick,
  onSettingsClick,
  signedIn,
  email,
}: SidebarProps) {
  const searching = query.trim() !== "";
  const { singles, albums } = partitionLibrary(filterLibrary(releases, query), sort);

  return (
    <aside className="sidebar flex w-full shrink-0 flex-row md:h-full md:w-64 md:flex-col">
      <nav
        aria-label="Main"
        className="flex items-center gap-2 overflow-x-auto p-3 md:flex-col md:items-stretch md:gap-1 md:overflow-visible md:p-4"
      >
        <button
          type="button"
          onClick={onLibraryClick}
          aria-current={view.type === "library" ? "page" : undefined}
          className={navItemClass(view.type === "library")}
        >
          <LibraryIcon className="h-4 w-4" />
          Library
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          aria-current={view.type === "settings" ? "page" : undefined}
          className={navItemClass(view.type === "settings")}
        >
          <SettingsIcon className="h-4 w-4" />
          Settings
        </button>
        <button
          type="button"
          onClick={onImportClick}
          aria-current={view.type === "import" ? "page" : undefined}
          className={`import-pill flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-hover md:mt-2 md:w-full ${focusRing} ${
            view.type === "import" ? "ring-2 ring-white/25" : ""
          }`}
        >
          <PlusIcon className="import-plus h-4 w-4" />
          <span className="import-label">Import</span>
        </button>
      </nav>

      <div className="hidden flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4 md:flex">
        {loading && <p className="px-2 text-sm text-text-muted">Loading…</p>}

        {!loading && releases.length > 0 && searching && (
          <div className="flex items-baseline justify-between gap-2 px-2 pb-1">
            <p className="min-w-0 truncate text-[11px] text-text-dim">
              Showing matches for “{query.trim()}”
            </p>
            <button
              type="button"
              onClick={onClearQuery}
              className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        {!loading &&
          releases.length > 0 &&
          searching &&
          singles.length === 0 &&
          albums.length === 0 && (
            <p className="px-2 py-2 text-sm text-text-muted">No matches.</p>
          )}

        {!loading && releases.length === 0 && (
          <p className="px-2 py-2 text-sm text-text-muted">
            No releases yet. Import your first track or album to get started.
          </p>
        )}

        {!loading && singles.length > 0 && (
          <SidebarSection
            label="Singles"
            count={singles.length}
            releases={singles}
            view={view}
            onSelectRelease={onSelectRelease}
          />
        )}

        {!loading && albums.length > 0 && (
          <SidebarSection
            label="Albums"
            count={albums.length}
            releases={albums}
            view={view}
            onSelectRelease={onSelectRelease}
          />
        )}
      </div>

      {/* #111 (sign-in and account) will fill this area. */}
      <div className="mx-3 mb-3 hidden shrink-0 items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
        <img src="/brand/listener-line.svg" alt="" className="h-6 w-6 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Locally</p>
          <p className="truncate text-xs text-text-dim">
            {signedIn ? (email ? email : "Syncing with your phone") : "On this Mac"}
          </p>
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  count,
  releases,
  view,
  onSelectRelease,
}: {
  label: string;
  count: number;
  releases: Release[];
  view: View;
  onSelectRelease: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 px-2 pb-1 pt-3">
        <h2 className="text-sm font-bold tracking-[-0.01em] text-text">{label}</h2>
        <span className="text-xs text-text-dim">{count}</span>
      </div>
      {releases.map((r) => {
        const active = view.type === "release" && view.id === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectRelease(r.id)}
            aria-current={active ? "page" : undefined}
            className={`side-row flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${focusRing} ${
              active ? "bg-white/[0.08]" : "hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
            }`}
          >
            {r.coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl(r.id, r.updatedAt)}
                alt=""
                className="side-thumb h-11 w-11 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-text-muted">
                <MusicNoteIcon className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text">
                {r.title || r.artist}
              </span>
              <span className="block truncate text-xs text-text-muted">{r.artist}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
