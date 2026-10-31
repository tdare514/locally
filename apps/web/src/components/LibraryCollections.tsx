"use client";

import type { Release } from "../shared/types";
import type { CollectionRecord } from "../shared/collections";
import { coverUrl } from "../lib/api-client";
import { NEUTRAL_PALETTE } from "../lib/artwork-palette";
import { COLLECTIONS_COPY, collectionCountLabel, collectionCoverIds } from "../lib/collections";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import { useCollections } from "./CollectionsContext";
import CollectionSleeve from "./CollectionSleeve";
import { ChevronRightIcon } from "./Icons";

/** The sleeve stack, in px: the front sleeve, how far each sleeve behind sits to its right, how far the disc peeks out,
 * the disc against the sleeve, and the tilts of the two behind (the iPhone's card, #360). */
const SLEEVE = 52;
const STEP = 4;
const PEEK = 24;
const DISC = SLEEVE * 0.92;
const BACK_TILTS = [-7, 5];
const STACK_HEIGHT = SLEEVE + 8;
const BACK_SHADOW = "0 3px 5px rgb(0 0 0 / 0.4)";

/** The surface the card, its loading placeholder and nothing else share: the Settings card's quiet recipe (rule 5). */
const SURFACE = "rounded-xl border border-white/[0.08] bg-white/[0.06]";

/**
 * The Library's one Collections card (#420, C24), the iPhone's card on the Mac: the first three collections' sleeves
 * stacked with a record peeking out, "Collections", the count and a chevron, washed from the left with the first
 * collection's cover colour. One click opens the Collections page; New collection lives there. A quiet card, not glass
 * (it sits in the page): no blur, glow or coloured shadow. Reads the collections itself, and the first cover's colour
 * the way the Collections page's backdrop does.
 */
export default function LibraryCollections({ releases, onOpen }: { releases: Release[]; onOpen: () => void }) {
  const api = useCollections();
  const first = api?.collections[0];
  const firstCover = first ? collectionCoverIds(first.items, releases)[0] : undefined;
  const firstRelease = firstCover ? releases.find((r) => r.id === firstCover) : undefined;
  const palette = useArtworkPalette(firstRelease ? coverUrl(firstRelease.id, firstRelease.updatedAt) : null);
  if (!api) return null;
  return (
    <CollectionsCard
      collections={api.collections}
      loaded={api.loaded}
      failed={api.failed}
      releases={releases}
      color={(palette ?? NEUTRAL_PALETTE).primary}
      onOpen={onOpen}
    />
  );
}

/** The card for a state of the collections, and the colour of the first cover ("#rrggbb"; grey with none). */
export function CollectionsCard({
  collections,
  loaded,
  failed,
  releases,
  color,
  onOpen,
}: {
  collections: readonly CollectionRecord[];
  loaded: boolean;
  failed: boolean;
  releases: readonly Release[];
  color: string;
  onOpen: () => void;
}) {
  // Same height and surface as the card, so nothing below moves when the collections arrive.
  if (!loaded) return <div aria-hidden="true" className={`min-h-20 w-full ${SURFACE}`} />;
  if (failed && collections.length === 0) {
    return <p className="px-1 text-sm text-text-muted">{COLLECTIONS_COPY.failedToLoad}</p>;
  }
  const subtitle = collections.length === 0 ? COLLECTIONS_COPY.none : collectionCountLabel(collections.length);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={collections.length === 0 ? "Collections" : `Collections, ${subtitle}`}
      className={`relative isolate flex min-h-20 w-full items-center gap-3.5 px-3.5 py-3 text-left outline-none transition-[scale,opacity,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] active:opacity-[0.85] motion-reduce:active:scale-100 ${SURFACE}`}
    >
      {/* The cover's colour washing in from the left: 40 % at the edge, clear by 70 % of the width, under the content. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        style={{ background: `linear-gradient(to right, ${color}, transparent 70%)`, opacity: 0.4 }}
      />
      <Sleeves collections={collections} releases={releases} color={color} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-text">Collections</span>
        <span className="line-clamp-2 block text-[13px] text-text-muted">{subtitle}</span>
      </span>
      <ChevronRightIcon aria-hidden="true" className="size-[18px] shrink-0 text-text-muted" />
    </button>
  );
}

/** The first three collections' sleeves, the first in front with a disc peeking out of its right edge; the two behind sit
 * 4 px further right each and tilt. With none, one empty sleeve and the disc. Static decoration. */
function Sleeves({ collections, releases, color }: { collections: readonly CollectionRecord[]; releases: readonly Release[]; color: string }) {
  const shown = collections.slice(0, 3);
  const behind = shown.slice(1).map((c, i) => ({ c, index: i + 1 }));
  return (
    <span aria-hidden="true" className="relative block shrink-0" style={{ width: SLEEVE + PEEK, height: STACK_HEIGHT }}>
      {/* Back to front: the furthest sleeve, the nearer one, the disc, then the front sleeve. */}
      {behind.reverse().map(({ c, index }) => (
        <span
          key={c.id}
          className="absolute top-1 block rounded-[8px]"
          style={{ left: STEP * index, width: SLEEVE, height: SLEEVE, transform: `rotate(${BACK_TILTS[index - 1]}deg)`, boxShadow: BACK_SHADOW }}
        >
          <CollectionSleeve items={c.items} releases={releases} className="size-full" />
        </span>
      ))}
      <Disc color={color} />
      <span className="absolute left-0 top-1 block" style={{ width: SLEEVE, height: SLEEVE }}>
        <CollectionSleeve items={shown[0]?.items ?? []} releases={releases} className="size-full" />
      </span>
    </span>
  );
}

/** A black disc with three faint grooves, a centre label in the cover's colour and a white rim, drawn on a 100-unit
 * square. Its right edge sits `PEEK` past the front sleeve. */
function Disc({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={DISC}
      height={DISC}
      aria-hidden="true"
      className="absolute"
      style={{ left: SLEEVE + PEEK - DISC, top: (STACK_HEIGHT - DISC) / 2 }}
    >
      <circle cx="50" cy="50" r="50" fill="#000" />
      {[0.78, 0.6, 0.46].map((ratio) => (
        <circle key={ratio} cx="50" cy="50" r={50 * ratio} fill="none" stroke="#fff" strokeOpacity={0.08} strokeWidth="1.5" />
      ))}
      <circle cx="50" cy="50" r={50 * 0.36} fill={color} />
      <circle cx="50" cy="50" r="49.2" fill="none" stroke="#fff" strokeOpacity={0.18} strokeWidth="1.6" />
    </svg>
  );
}
