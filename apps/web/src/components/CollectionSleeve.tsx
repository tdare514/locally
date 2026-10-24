import type { Release } from "../shared/types";
import type { CollectionItem } from "../shared/collections";
import { collectionCoverIds } from "../lib/collections";
import { coverUrl } from "../lib/api-client";
import NoCover from "./NoCover";

/**
 * A collection's cover (#349): the 2x2 of the first four different covers among its items, one cover when there is
 * only one, the empty note when there is none. A square of the given size from the first paint, so nothing shifts as
 * covers load. Decoration: the collection's name sits beside it.
 */
export default function CollectionSleeve({
  items,
  releases,
  className = "size-12",
  single = false,
}: {
  items: readonly CollectionItem[];
  releases: readonly Release[];
  /** The size and radius; the sleeve fills it. */
  className?: string;
  /** The record player's paper sleeve: the first cover alone, never the 2x2. */
  single?: boolean;
}) {
  const ids = collectionCoverIds(items, releases);
  const cover = (id: string) => {
    const r = releases.find((x) => x.id === id);
    return r ? coverUrl(r.id, r.updatedAt) : "";
  };
  return (
    <span aria-hidden="true" className={`relative block shrink-0 overflow-hidden rounded-[8px] bg-card ${className}`}>
      {ids.length === 0 ? (
        <NoCover className="size-full" />
      ) : single || ids.length === 1 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover(ids[0])} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-px bg-border">
          {[0, 1, 2, 3].map((i) =>
            ids[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={cover(ids[i])} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <span key={i} className="bg-card" />
            ),
          )}
        </span>
      )}
    </span>
  );
}
