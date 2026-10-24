"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createCollection, deleteCollection, getCollections, updateCollection } from "../lib/api-client";
import { addItems } from "../lib/collections";
import { TOO_MANY_COLLECTIONS, type CollectionItem, type CollectionRecord, type KnownItem } from "../shared/collections";

type Toast = (kind: "success" | "error", text: string) => void;

export interface CollectionsApi {
  collections: CollectionRecord[];
  /** The first read has finished (before it, the page shows placeholders). */
  loaded: boolean;
  failed: boolean;
  /** The sync service refuses new collections (it holds 1,000): the plan's wording, or null. */
  problem: string | null;
  refresh: () => Promise<void>;
  /** Makes a collection holding `items`; resolves it, or null after a toast. */
  create: (name: string, items?: KnownItem[]) => Promise<CollectionRecord | null>;
  /** Appends `items` that are not there yet; resolves how many were added, or null after a toast. */
  addTo: (id: string, items: KnownItem[]) => Promise<number | null>;
  /** Replaces the name and/or the items; the page shows the change at once and settles on the saved record. */
  save: (id: string, patch: { name?: string; items?: CollectionItem[] }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

const Ctx = createContext<CollectionsApi | null>(null);

/** The collections of this Mac, or null outside the provider (a test, the demo's inert parts). */
export function useCollections(): CollectionsApi | null {
  return useContext(Ctx);
}

/** Holds the collections for the whole window (#349): components add to and edit them without prop drilling. */
export function CollectionsProvider({ onToast, children }: { onToast: Toast; children: ReactNode }) {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useRef(onToast);
  useEffect(() => {
    toast.current = onToast;
  });
  const latest = useRef(collections);
  useEffect(() => {
    latest.current = collections;
  });

  const refresh = useCallback(async () => {
    try {
      const out = await getCollections();
      setCollections(out.collections);
      setProblem(out.problem === "too_many_collections" ? TOO_MANY_COLLECTIONS : null);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // A pull from another device lands in the file: look again now and then.
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const save = useCallback(
    async (id: string, patch: { name?: string; items?: CollectionItem[] }) => {
      setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      try {
        const saved = await updateCollection(id, patch);
        setCollections((prev) => prev.map((c) => (c.id === id ? saved : c)));
        return true;
      } catch (e) {
        toast.current("error", e instanceof Error ? e.message : "Couldn't save the collection");
        await refresh();
        return false;
      }
    },
    [refresh],
  );

  const api = useMemo<CollectionsApi>(
    () => ({
      collections,
      loaded,
      failed,
      problem,
      refresh,
      save,
      async create(name, items = []) {
        try {
          const made = await createCollection(name, items);
          setCollections((prev) => [...prev, made]);
          return made;
        } catch (e) {
          toast.current("error", e instanceof Error ? e.message : "Couldn't make the collection");
          return null;
        }
      },
      async addTo(id, items) {
        const current = latest.current.find((c) => c.id === id);
        if (!current) return null;
        const { items: next, added } = addItems(current.items, items);
        if (added === 0) return 0;
        return (await save(id, { items: next })) ? added : null;
      },
      async remove(id) {
        try {
          await deleteCollection(id);
          setCollections((prev) => prev.filter((c) => c.id !== id));
          return true;
        } catch (e) {
          toast.current("error", e instanceof Error ? e.message : "Couldn't delete the collection");
          return false;
        }
      },
    }),
    [collections, loaded, failed, problem, refresh, save],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
