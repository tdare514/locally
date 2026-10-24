"use client";

import { useId, useRef, useState } from "react";
import { itemKey as recordItemKey, type KnownItem } from "../shared/collections";
import { filterCollections } from "../lib/collections";
import { normalizeSearchText } from "../lib/library-sections";
import { useCollections } from "./CollectionsContext";
import { PlusIcon, SearchIcon } from "./Icons";
import NewCollectionForm from "./NewCollectionForm";
import Popover, { MENU_ITEM } from "./Popover";

/** More collections than this and the list gets a search field. */
export const SEARCH_AFTER = 8;

/**
 * "Add to collection" (#349): a button that opens a list of the collections and "New collection…". `getItems` is read
 * when a choice is made (the selected releases, one track, a whole release). `variant` "row" is an icon button for a
 * track row (also opened by the row's right-click, through `data-collect-button`); "bar" is a text button for the
 * release bar and the Library's selection bar.
 */
export default function AddToCollection({
  name,
  getItems,
  variant,
  disabled,
  onDone,
}: {
  /** What is being added, for the button's name: a track title or a release title. */
  name: string;
  getItems: () => KnownItem[];
  variant: "row" | "bar";
  disabled?: boolean;
  /** Called after a successful add, so a selection bar can leave selection mode. */
  onDone?: () => void;
}) {
  const api = useCollections();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  if (!api) return null;

  const items = open ? getItems() : [];
  const shown = filterCollections(api.collections, query, normalizeSearchText);
  const close = (returnFocus: boolean) => {
    setOpen(false);
    setCreating(false);
    setQuery("");
    if (returnFocus) buttonRef.current?.focus();
  };

  async function choose(collectionId: string, collectionName: string) {
    const added = await api!.addTo(collectionId, getItems());
    if (added === null) return;
    setNote(added === 0 ? `Already in ${collectionName}` : `Added to ${collectionName}`);
    close(true);
    onDone?.();
  }

  async function createAndAdd(newName: string) {
    const made = await api!.create(newName, getItems());
    if (!made) return;
    setNote(`Added to ${made.name}`);
    close(true);
    onDone?.();
  }

  const label = `Add ${name} to a collection`;
  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-collect-button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          setNote("");
          setOpen((o) => !o);
        }}
        {...(variant === "row"
          ? { "aria-label": label, title: "Add to collection", className: "btn-icon share-row-button flex size-11 items-center justify-center rounded-md text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent" }
          : { className: "btn-ink min-h-11" })}
      >
        {variant === "row" ? (
          <PlusIcon className="h-4 w-4" />
        ) : (
          <span className="btn-ink-label">Add to collection</span>
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {note}
      </span>
      <Popover open={open} anchorRef={buttonRef} onClose={close} label="Add to collection" role="menu">
        <div id={id}>
          {creating ? (
            <NewCollectionForm onCreate={createAndAdd} onCancel={() => setCreating(false)} submitLabel="Create and add" />
          ) : (
            <>
              {api.collections.length > SEARCH_AFTER && (
                <div className="relative p-1">
                  <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="search"
                    data-menu-search
                    value={query}
                    aria-label="Search collections"
                    placeholder="Search collections"
                    onChange={(e) => setQuery(e.target.value)}
                    className="min-h-11 w-full rounded-[12px] bg-elevated pl-10 pr-3 text-sm text-text outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent"
                  />
                </div>
              )}
              {shown.map((c) => {
                const have = new Set(c.items.map(recordItemKey));
                const allIn = items.length > 0 && items.every((i) => have.has(recordItemKey(i)));
                return (
                  <button key={c.id} type="button" role="menuitem" onClick={() => choose(c.id, c.name)} className={MENU_ITEM}>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-text-muted">{allIn ? "Added" : `${c.items.length} ${c.items.length === 1 ? "item" : "items"}`}</span>
                  </button>
                );
              })}
              {shown.length === 0 && api.collections.length > 0 && (
                <p className="px-3 py-2 text-sm text-text-muted">No collection matches “{query.trim()}”.</p>
              )}
              <button type="button" role="menuitem" onClick={() => setCreating(true)} className={MENU_ITEM}>
                <PlusIcon className="h-4 w-4 shrink-0" />
                <span>New collection…</span>
              </button>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
