"use client";

import { useState } from "react";
import type { Release } from "../shared/types";
import { COLLECTIONS_COPY, collectionTotals, trackCountLabel } from "../lib/collections";
import { useCollections } from "./CollectionsContext";
import CollectionSleeve from "./CollectionSleeve";
import { PlusIcon } from "./Icons";
import NewCollectionForm from "./NewCollectionForm";

/**
 * The body of the Library's Collections section (#349): a slim row of each collection's sleeve, name and count, then
 * New collection. With none, the plan's line, smaller, and the same button. The heading and its fold are the Library's.
 */
export default function LibraryCollections({
  releases,
  onOpen,
}: {
  releases: Release[];
  onOpen: (id: string) => void;
}) {
  const api = useCollections();
  const [making, setMaking] = useState(false);
  if (!api) return null;
  const newButton = (
    <button type="button" onClick={() => setMaking((m) => !m)} aria-expanded={making} className="btn-ink min-h-11 shrink-0">
      <PlusIcon className="h-4 w-4" />
      New collection
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      {!api.loaded ? (
        <div aria-busy="true" aria-label="Loading collections" className="flex gap-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex h-14 w-48 items-center gap-3 rounded-xl p-1.5">
              <span className="size-12 rounded-[8px] bg-card" />
              <span className="h-3 w-20 rounded-full bg-card" />
            </span>
          ))}
        </div>
      ) : api.failed && api.collections.length === 0 ? (
        <p className="px-1 text-sm text-text-muted">{COLLECTIONS_COPY.failedToLoad}</p>
      ) : api.collections.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <p className="text-sm text-text-muted">{COLLECTIONS_COPY.none}</p>
          {newButton}
        </div>
      ) : (
        <ul className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          {api.collections.map((c) => (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex h-14 w-52 items-center gap-3 rounded-xl p-1.5 text-left outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent"
              >
                <CollectionSleeve items={c.items} releases={releases} className="size-12" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-text">{c.name}</span>
                  <span className="block truncate text-xs text-text-muted">{trackCountLabel(collectionTotals(c.items, releases).tracks)}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="shrink-0">{newButton}</li>
        </ul>
      )}
      {making && (
        <div className="max-w-xl">
          <NewCollectionForm
            onCancel={() => setMaking(false)}
            onCreate={async (name) => {
              const made = await api.create(name);
              if (made) {
                setMaking(false);
                onOpen(made.id);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
