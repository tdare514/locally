"use client";

import type { PendingFromPhone, Release } from "../shared/types";
import { coverUrl } from "../lib/api-client";
import { partitionLibrary } from "../lib/library-sections";
import type { View } from "./AppShell";
import { MusicNoteIcon } from "./Icons";

interface SidebarProps {
  releases: Release[];
  loading: boolean;
  view: View;
  pendingFromPhone: PendingFromPhone[];
  onAcceptFromPhone: (id: string) => void;
  onSelectRelease: (id: string) => void;
  onLibraryClick: () => void;
  onImportClick: () => void;
  onSettingsClick: () => void;
}

function navPillClass(active: boolean): string {
  return `shrink-0 rounded-full px-4 py-2 text-left text-sm font-semibold transition-colors md:rounded-md ${
    active ? "bg-accent text-black" : "bg-elevated text-text hover:bg-elevated-hover"
  }`;
}

export default function Sidebar({
  releases,
  loading,
  view,
  pendingFromPhone,
  onAcceptFromPhone,
  onSelectRelease,
  onLibraryClick,
  onImportClick,
  onSettingsClick,
}: SidebarProps) {
  const { singles, albums } = partitionLibrary(releases);

  return (
    <aside className="flex w-full shrink-0 flex-row border-b border-border bg-card md:h-full md:w-64 md:flex-col md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 overflow-x-auto p-3 md:flex-col md:items-stretch md:gap-2 md:overflow-visible md:p-4">
        <button
          type="button"
          onClick={onLibraryClick}
          className={navPillClass(view.type === "library")}
        >
          Library
        </button>
        <button
          type="button"
          onClick={onImportClick}
          className={navPillClass(view.type === "import")}
        >
          + Import
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          className={navPillClass(view.type === "settings")}
        >
          ⚙ Settings
        </button>
      </div>

      <div className="hidden flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4 md:flex">
        {pendingFromPhone.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            <p className="px-2 py-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
              From your phone
            </p>
            {pendingFromPhone.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-elevated text-text-muted">
                  <MusicNoteIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">
                    {p.title || p.artist}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {p.artist} · {p.trackCount} track{p.trackCount === 1 ? "" : "s"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onAcceptFromPhone(p.id)}
                  className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-accent-hover active:scale-95"
                >
                  Send to Spotify
                </button>
              </div>
            ))}
          </div>
        )}

        {loading && <p className="px-2 text-sm text-text-muted">Loading…</p>}

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

        {!loading && singles.length > 0 && albums.length > 0 && (
          <div
            className="mx-2 my-2 border-t border-dashed border-border-dashed"
            aria-hidden="true"
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

      <div className="hidden shrink-0 items-center gap-2 border-t border-border px-4 py-3 md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
        <img src="/brand/listener-line.svg" alt="" className="h-6 w-6" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-dim">
          Locally
        </span>
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
      <div className="flex items-baseline justify-between gap-2 px-2 py-2">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          {label}
        </p>
        <span className="text-[10px] text-text-dim">{count}</span>
      </div>
      {releases.map((r) => {
        const active = view.type === "release" && view.id === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectRelease(r.id)}
            className={`flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
              active ? "bg-row-hover" : "hover:bg-row-hover"
            }`}
          >
            {r.coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl(r.id, r.updatedAt)}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-elevated text-text-muted">
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
