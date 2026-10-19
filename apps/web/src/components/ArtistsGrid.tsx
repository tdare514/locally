"use client";

import { coverUrl } from "../lib/api-client";
import { artistCountLine, groupByLetter, type CatalogEntry, type CoverRef } from "../lib/artist-catalog";
import { COVER_GRID_GAP_PX, COVER_TILE_MIN_PX } from "../lib/library-view-prefs";
import NoCover from "./NoCover";

/** Up to three covers fanned like sleeves on a shelf: the newest in front, the others offset up and
 * to the right with a small turn. The front cover is the same size and place whether there are one, two or three. */
export function ArtistCoverStack({ covers }: { covers: CoverRef[] }) {
  const shadow = "shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]";
  const count = covers.length;
  return (
    <div className="artist-stack relative aspect-square">
      {count === 0 && (
        <NoCover className={`absolute bottom-0 left-0 aspect-square w-[80%] rounded-lg ${shadow}`} />
      )}
      {covers.map((cover, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cover.releaseId}
          src={coverUrl(cover.releaseId, cover.updatedAt)}
          alt=""
          className={`absolute aspect-square w-[80%] rounded-lg object-cover ${shadow}`}
          style={{
            left: `${i * 10}%`,
            bottom: `${i * 10}%`,
            zIndex: count - i,
            transform: `rotate(${i * 3}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** The Library's Artists view: a tile per artist, A to Z in one grid. Each tile is one
 * button that opens the artist's page. */
export default function ArtistsGrid({
  entries,
  onOpenArtist,
  onFocusArtist,
}: {
  entries: CatalogEntry[];
  onOpenArtist: (key: string) => void;
  onFocusArtist: (key: string) => void;
}) {
  // One continuous grid, A to Z with "#" last (the order groupByLetter gives), no headings.
  const ordered = groupByLetter(entries).flatMap((g) => g.entries);
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${COVER_TILE_MIN_PX[1]}px, 1fr))`,
        gap: COVER_GRID_GAP_PX[1],
      }}
    >
      {ordered.map((entry) => (
        <button
          key={entry.key}
          type="button"
          data-artist-key={entry.key}
          onClick={() => onOpenArtist(entry.key)}
          onMouseEnter={() => onFocusArtist(entry.key)}
          onFocus={() => onFocusArtist(entry.key)}
          className="shelf-tile min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
        >
          <ArtistCoverStack covers={entry.covers} />
          <span className="mt-3 block truncate text-sm font-semibold text-text">{entry.name}</span>
          <span className="block truncate text-xs text-text-muted">{artistCountLine(entry)}</span>
        </button>
      ))}
    </div>
  );
}
