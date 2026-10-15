"use client";

import { SearchIcon } from "../../Icons";
import { SAMPLE_RELEASES } from "./sample-data";
import { useCovers } from "./use-stats";

/** A stand-in for the library view, only so the sidebar has something to float over (#154). It
 * follows the real one's shape: a title, a search and sort row, then Singles and Albums as covers,
 * in a 920px column like the default "Comfortable" width. */
export default function MockLibrary() {
  const covers = useCovers();
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <h1 className="text-[28px] font-bold tracking-[-0.02em] text-text">All music</h1>
      <p className="mt-1 text-sm text-text-muted">{SAMPLE_RELEASES.length} releases</p>

      <div aria-hidden className="mt-6 flex items-center gap-3">
        <div className="flex h-10 flex-1 items-center gap-2.5 rounded-full bg-white/[0.07] px-4 text-sm text-text-muted">
          <SearchIcon className="h-4 w-4" />
          Search your library
        </div>
        <div className="flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm text-text-muted">
          Recently updated
        </div>
      </div>

      {(["single", "album"] as const).map((kind) => {
        const list = SAMPLE_RELEASES.filter((r) => r.kind === kind);
        return (
          <section key={kind} className="mt-9">
            <div className="flex items-baseline gap-2 pb-3">
              <h2 className="text-sm font-bold tracking-[-0.01em] text-text">
                {kind === "single" ? "Singles" : "Albums"}
              </h2>
              <span className="text-xs text-text-dim">{list.length}</span>
            </div>
            <div className="grid grid-cols-5 gap-5">
              {list.map((r) => (
                <div key={r.id} className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI */}
                  <img
                    src={covers[r.id]}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover shadow-[0_14px_26px_-14px_rgb(0_0_0/0.8)]"
                  />
                  <p className="mt-2 truncate text-sm font-medium text-text">{r.title}</p>
                  <p className="truncate text-xs text-text-muted">{r.artist}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** What Settings and Stats show in the prototype: a title, so a click on them is observable. */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <h1 className="text-[28px] font-bold tracking-[-0.02em] text-text">{title}</h1>
      <p className="mt-1 text-sm text-text-muted">{note}</p>
    </div>
  );
}
