"use client";

import type { Release } from "../shared/types";
import { coverUrl } from "../lib/api-client";
import type { View } from "./AppShell";

interface SidebarProps {
  releases: Release[];
  loading: boolean;
  view: View;
  onSelectRelease: (id: string) => void;
  onImportClick: () => void;
  onSettingsClick: () => void;
}

export default function Sidebar({
  releases,
  loading,
  view,
  onSelectRelease,
  onImportClick,
  onSettingsClick,
}: SidebarProps) {
  const sorted = [...releases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <aside className="flex w-full shrink-0 flex-row border-b border-border bg-panel md:h-full md:w-64 md:flex-col md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 overflow-x-auto p-3 md:flex-col md:items-stretch md:gap-2 md:overflow-visible md:p-4">
        <button
          type="button"
          onClick={onImportClick}
          className={`shrink-0 rounded-full px-4 py-2 text-left text-sm font-semibold transition-colors md:rounded-md ${
            view.type === "import"
              ? "bg-accent text-black"
              : "bg-elevated text-text hover:bg-elevated-hover"
          }`}
        >
          + Import
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          className={`shrink-0 rounded-full px-4 py-2 text-left text-sm font-semibold transition-colors md:rounded-md ${
            view.type === "settings"
              ? "bg-accent text-black"
              : "bg-elevated text-text hover:bg-elevated-hover"
          }`}
        >
          ⚙ Settings
        </button>
      </div>

      <div className="hidden flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4 md:flex">
        <p className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Library
        </p>
        {loading && <p className="px-2 text-sm text-text-muted">Loading…</p>}
        {!loading && sorted.length === 0 && (
          <p className="px-2 text-sm text-text-muted">
            No releases yet. Import your first track or album to get started.
          </p>
        )}
        {sorted.map((r) => {
          const active = view.type === "release" && view.id === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRelease(r.id)}
              className={`flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                active ? "bg-elevated" : "hover:bg-elevated"
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
                  ♪
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">
                  {r.title || r.artist}
                </span>
                <span className="block truncate text-xs text-text-muted">{r.artist}</span>
              </span>
              <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {r.kind === "single" ? "Single" : "Album"}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
