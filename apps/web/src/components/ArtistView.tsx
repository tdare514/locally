"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { Release, Track } from "../shared/types";
import { coverUrl } from "../lib/api-client";
import { splitFeaturing } from "../lib/artist-names";
import {
  artistPageLine,
  mostPlayed,
  type AppearsOn,
  type CatalogEntry,
  type MostPlayed,
} from "../lib/artist-catalog";
import { COVER_GRID_GAP_PX, COVER_TILE_MIN_PX, libraryWidthClass } from "../lib/library-view-prefs";
import { playsCount } from "../lib/stats-copy";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import { useLibraryWidth } from "../lib/use-library-width";
import AmbientBackdrop from "./AmbientBackdrop";
import ArtistLinks from "./ArtistNav";
import NoCover from "./NoCover";
import { usePlayStats } from "./sidebar/use-stats";

const COVER_SHADOW = "shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]";

function Section({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-baseline gap-2 px-1 text-[22px] font-bold tracking-[-0.03em] text-text">
        <span>{label}</span>
        <span className="text-sm font-normal tracking-normal text-text-dim">{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** A release as a Grid medium tile: cover, title, year under it. Opens the release. */
function ReleaseTile({ release, onOpen }: { release: Release; onOpen: (id: string) => void }) {
  const url = release.coverPath ? coverUrl(release.id, release.updatedAt) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(release.id)}
      className="shelf-tile min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
    >
      <div className="relative aspect-square">
        <div className="shelf-cover h-full w-full rounded-lg">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className={`h-full w-full rounded-lg object-cover ${COVER_SHADOW}`} />
          ) : (
            <NoCover className={`h-full w-full rounded-lg ${COVER_SHADOW}`} />
          )}
        </div>
      </div>
      <span className="mt-3 block truncate text-sm font-semibold text-text">{release.title || release.artist}</span>
      {release.year && <span className="block truncate text-xs text-text-muted">{release.year}</span>}
    </button>
  );
}

function TileGrid({ releases, onOpen }: { releases: Release[]; onOpen: (id: string) => void }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${COVER_TILE_MIN_PX[1]}px, 1fr))`,
        gap: COVER_GRID_GAP_PX[1],
      }}
    >
      {releases.map((release) => (
        <ReleaseTile key={release.id} release={release} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** A track row: small cover, the plain title (opens the release at that track), the artist line with
 * every name a link, and under it the release and year. The title is the keyboard stop; a click
 * elsewhere on the row opens it too, and a name link opens that artist instead. */
function TrackRow({
  release,
  track,
  rank,
  trailing,
  onOpen,
}: {
  release: Release;
  track: Track;
  rank?: number;
  trailing?: string;
  onOpen: (releaseId: string, trackId: string) => void;
}) {
  const url = release.coverPath ? coverUrl(release.id, release.updatedAt) : null;
  const { title, featuring } = splitFeaturing(track.title);
  const where = [release.title, release.year].filter((part) => part && part.trim() !== "").join(", ");
  return (
    <li>
      <div
        onClick={() => onOpen(release.id, track.id)}
        className="-mx-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.07] motion-reduce:transition-none"
      >
        {rank !== undefined && (
          <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-text-muted">{rank}</span>
        )}
        <span className="size-10 shrink-0">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-10 rounded-md object-cover" />
          ) : (
            <NoCover className="size-10 rounded-md" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <button
            type="button"
            data-row-open
            className="block max-w-full truncate rounded-sm text-left text-[15px] font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {title || "Untitled"}
          </button>
          <span className="block truncate text-sm text-text-muted">
            {release.artist.trim() !== "" ? <ArtistLinks artist={release.artist} featuring={featuring} /> : null}
          </span>
          {where && <span className="block truncate text-xs text-text-muted">{where}</span>}
        </span>
        {trailing && <span className="shrink-0 text-sm tabular-nums text-text-muted">{trailing}</span>}
      </div>
    </li>
  );
}

/** The artist page (#288): the cover wash of their newest release, their name and a count line, then
 * Albums, Singles, Appears on and Most played, each hidden when empty. `entry` is null for a key the
 * library no longer has. */
export default function ArtistView({
  entry,
  releases,
  onOpenRelease,
  onGoToLibrary,
}: {
  entry: CatalogEntry | null;
  releases: Release[];
  onOpenRelease: (id: string, trackId?: string) => void;
  onGoToLibrary: () => void;
}) {
  const [width] = useLibraryWidth();
  const rootRef = useRef<HTMLDivElement>(null);
  const newest = entry?.newest ?? null;
  const palette = useArtworkPalette(newest?.coverPath ? coverUrl(newest.id, newest.updatedAt) : null);
  // All-time plays from the same read the Stats page uses (the demo has none).
  const { state } = usePlayStats({ kind: "all", back: 0 }, releases, entry !== null, Infinity);
  const top = useMemo<MostPlayed[]>(() => {
    if (!entry || state.status !== "ready") return [];
    return mostPlayed(entry, new Map(state.stats.tracks.map((t) => [t.id, t.plays])));
  }, [entry, state]);

  // Another artist's page opens at the top; going back restores its own scroll after this runs.
  useLayoutEffect(() => {
    rootRef.current?.closest("main")?.scrollTo(0, 0);
  }, [entry?.key]);

  if (!entry) {
    return (
      <div ref={rootRef} className={`flex flex-col items-start gap-4 pt-2 ${libraryWidthClass(width)}`}>
        <p className="text-text-muted">This artist isn&apos;t in your library any more.</p>
        <button type="button" onClick={onGoToLibrary} className="btn-ink">
          Back to Library
        </button>
      </div>
    );
  }

  const appears: AppearsOn[] = entry.appearsOn;
  return (
    <div ref={rootRef} className={`flex flex-col gap-10 pb-16 ${libraryWidthClass(width)}`}>
      <AmbientBackdrop palette={palette} />
      <div aria-hidden className="st-scrim" />
      <header className="flex flex-col gap-2 pt-2 lg:pt-4">
        <h1 className="max-w-[min(100%,720px)] break-words text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-text sm:text-[44px]">
          {entry.name}
        </h1>
        <p className="text-[15px] text-text-muted">{artistPageLine(entry)}</p>
      </header>

      {entry.albums.length > 0 && (
        <Section label="Albums" count={entry.albums.length}>
          <TileGrid releases={entry.albums} onOpen={onOpenRelease} />
        </Section>
      )}
      {entry.singles.length > 0 && (
        <Section label="Singles" count={entry.singles.length}>
          <TileGrid releases={entry.singles} onOpen={onOpenRelease} />
        </Section>
      )}
      {appears.length > 0 && (
        <Section label="Appears on" count={appears.length}>
          <ol aria-label="Appears on">
            {appears.map(({ release, track }) => (
              <TrackRow key={track.id} release={release} track={track} onOpen={onOpenRelease} />
            ))}
          </ol>
        </Section>
      )}
      {top.length > 0 && (
        <Section label="Most played" count={top.length}>
          <ol aria-label="Most played">
            {top.map((row, i) => (
              <TrackRow
                key={row.track.id}
                release={row.release}
                track={row.track}
                rank={i + 1}
                trailing={playsCount(row.plays)}
                onOpen={onOpenRelease}
              />
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
