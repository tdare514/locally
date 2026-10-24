import { describe, expect, it } from "vitest";
import type { CollectionStore, RemoteOutcome, StoredCollection } from "../../src/server/collections/CollectionStore";
import { SyncEngine } from "../../src/server/sync/SyncEngine";
import { SyncConflictError, SyncRequestError, TooManyCollectionsError, type SyncApi } from "../../src/server/sync/SyncApi";
import { emptySyncState, type SyncState, type SyncStateStore } from "../../src/server/sync/SyncState";
import type { CollectionRecord, CollectionsPage } from "../../src/shared/collections";
import type { Settings } from "../../src/shared/types";

const ID = "9c1e2f40-6b3a-4d7e-8a51-2f0c9d4b7e13";
const ID2 = "5b7d2a10-3c4e-4f68-9a21-8e6f1d0c2b34";

function record(over: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    syncVersion: 1,
    id: ID,
    name: "Late drives",
    items: [{ kind: "release", releaseId: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90" }],
    origin: "mac",
    originDevice: "Toby's MacBook",
    createdAt: "2026-10-23T20:00:00Z",
    updatedAt: "2026-10-23T20:00:00Z",
    deleted: false,
    ...over,
  };
}

/** In-memory store with the real store's pull rules. */
class MemoryCollectionStore implements CollectionStore {
  entriesById = new Map<string, StoredCollection>();
  account: string | null = null;
  async list() {
    return [...this.entriesById.values()].map((e) => e.record).filter((r) => !r.deleted);
  }
  async create(): Promise<CollectionRecord> {
    throw new Error("unused");
  }
  async update(): Promise<CollectionRecord | null> {
    throw new Error("unused");
  }
  async remove(id: string) {
    const e = this.entriesById.get(id)!;
    e.record = { ...e.record, deleted: true, updatedAt: "2026-10-23T21:00:00Z" };
    return true;
  }
  async entries() {
    return [...this.entriesById.values()];
  }
  async markPushed(id: string, updatedAt: string) {
    const e = this.entriesById.get(id);
    if (e && e.record.updatedAt === updatedAt) e.pushed = updatedAt;
  }
  async applyRemote(r: CollectionRecord): Promise<RemoteOutcome> {
    const e = this.entriesById.get(r.id);
    if (e && e.pushed !== e.record.updatedAt && e.record.updatedAt > r.updatedAt) return "kept-local";
    this.entriesById.set(r.id, { record: r, pushed: r.updatedAt });
    return "applied";
  }
  async bindAccount(key: string | null) {
    this.account = key;
  }
  add(r: CollectionRecord, pushed: string | null) {
    this.entriesById.set(r.id, { record: r, pushed });
  }
}

class MemoryState implements SyncStateStore {
  state: SyncState = emptySyncState();
  async get() {
    return { ...this.state };
  }
  async set(s: SyncState) {
    this.state = s;
    return s;
  }
  async update(m: (c: SyncState) => SyncState | null) {
    const next = m({ ...this.state });
    if (next) this.state = next;
    return this.state;
  }
}

/** A fake service answering the literal wire shapes. `order` records every call. */
class FakeApi {
  order: string[] = [];
  pages: CollectionsPage[] = [{ collections: [], nextVersion: 0, hasMore: false }];
  listCalls: number[] = [];
  put: (r: CollectionRecord) => Promise<{ version: number; pruned: number }> = async () => ({ version: 5, pruned: 0 });
  listFails: Error | null = null;
  deletes: string[] = [];
  deleteFails: Error | null = null;
  async listReleases() {
    this.order.push("listReleases");
    return { releases: [], nextVersion: 0, hasMore: false };
  }
  async listReceivedShares() {
    throw new SyncRequestError("Not found", 404);
  }
  async me() {
    this.order.push("me");
    throw new Error("skip");
  }
  async missingFiles() {
    return null;
  }
  async listCollections(since: number) {
    this.order.push("listCollections");
    this.listCalls.push(since);
    if (this.listFails) throw this.listFails;
    return this.pages[Math.min(this.listCalls.length - 1, this.pages.length - 1)];
  }
  async putCollection(r: CollectionRecord) {
    this.order.push(`put:${r.id}`);
    return this.put(r);
  }
  async deleteCollection(id: string) {
    this.order.push(`delete:${id}`);
    this.deletes.push(id);
    if (this.deleteFails) throw this.deleteFails;
    return { version: 9 };
  }
}

function setup() {
  const store = new MemoryCollectionStore();
  const api = new FakeApi();
  const state = new MemoryState();
  let current = { libraryDir: "/tmp/x", sync: { baseUrl: "https://x.test", deviceToken: "tok", email: "a@b.c", lastVersion: 0 } } as Settings;
  const settings = {
    get: async () => current,
    update: async (m: (c: Settings) => Settings | null) => {
      current = m(current) ?? current;
      return current;
    },
  };
  const releases = { list: async () => [], get: async () => null };
  const engine = new SyncEngine(
    settings as never,
    state,
    releases as never,
    {} as never,
    () => api as unknown as SyncApi,
    () => "Toby's MacBook",
    null,
    undefined,
    undefined,
    store,
  );
  return { store, api, state, engine };
}

describe("collections sync", () => {
  it("pushes changed collections, then deletes, then pulls, all after releases", async () => {
    const { store, api, engine } = setup();
    store.add(record({ id: ID }), null); // changed
    store.add(record({ id: ID2, deleted: true, updatedAt: "2026-10-23T22:00:00Z" }), "2026-10-23T20:00:00Z"); // delete known to the service
    await engine.reconcile();
    const calls = api.order.filter((c) => c !== "me");
    expect(calls).toEqual(["listReleases", `put:${ID}`, `delete:${ID2}`, "listCollections"]);
    const entries = await store.entries();
    expect(entries.every((e) => e.pushed === e.record.updatedAt)).toBe(true);
  });

  it("a tombstone with no pushed marker is still sent (a PUT whose reply was lost)", async () => {
    const { store, api, engine } = setup();
    store.add(record({ deleted: true }), null);
    await engine.reconcile();
    expect(api.deletes).toEqual([ID]);
    expect((await store.entries())[0].pushed).toBe(record().updatedAt);
  });

  it("a DELETE answered 404 is done when the route has been seen", async () => {
    const { store, api, state, engine } = setup();
    state.state.collectionsRouteSeen = true;
    store.add(record({ deleted: true }), "2026-10-23T19:00:00Z");
    api.deleteFails = new SyncRequestError("Not found", 404);
    await engine.reconcile();
    expect((await store.entries())[0].pushed).toBe(record().updatedAt);
  });

  it("a DELETE answered 404 stays pending when the GET is 404 too (an older API)", async () => {
    const { store, api, state, engine } = setup();
    store.add(record({ deleted: true }), "2026-10-23T19:00:00Z");
    api.deleteFails = new SyncRequestError("Not found", 404);
    api.listFails = new SyncRequestError("Not found", 404);
    await engine.reconcile();
    expect((await store.entries())[0].pushed).toBe("2026-10-23T19:00:00Z");
    expect(state.state.collectionsRouteSeen).toBeUndefined();
  });

  it("a never-pushed tombstone is cleared after one 404", async () => {
    const { store, api, engine } = setup();
    store.add(record({ deleted: true }), null);
    api.deleteFails = new SyncRequestError("Not found", 404);
    await engine.reconcile();
    expect(api.deletes).toEqual([ID]);
    expect((await store.entries())[0].pushed).toBe(record().updatedAt);
  });

  it("a successful pull page marks the route as seen", async () => {
    const { state, engine } = setup();
    await engine.reconcile();
    expect(state.state.collectionsRouteSeen).toBe(true);
  });

  it("pages while hasMore and keeps nextVersion as the cursor", async () => {
    const { store, api, state, engine } = setup();
    api.pages = [
      { collections: [{ ...record({ id: ID }), version: 3 }], nextVersion: 3, hasMore: true },
      { collections: [{ ...record({ id: ID2, name: "Two" }), version: 7 }], nextVersion: 7, hasMore: false },
    ];
    await engine.reconcile();
    expect(api.listCalls).toEqual([0, 3]);
    expect((await store.list()).map((c) => c.name).sort()).toEqual(["Late drives", "Two"]);
    expect(state.state.collectionsVersion).toBe(7);
    await engine.reconcile();
    expect(api.listCalls.at(-1)).toBe(7);
  });

  it("a 404 (an older API) is skipped quietly and leaves the cursor and records", async () => {
    const { store, api, state, engine } = setup();
    store.add(record(), null);
    api.listFails = new SyncRequestError("Not found", 404);
    await engine.reconcile();
    expect((await engine.status()).lastError).toBeNull();
    expect(state.state.collectionsVersion).toBeUndefined();
    expect((await store.entries())[0].pushed).toBe(record().updatedAt);
  });

  it("a 429 on a push is skipped quietly and the record stays unpushed", async () => {
    const { store, api, engine } = setup();
    store.add(record(), null);
    api.put = async () => {
      throw new SyncRequestError("Slow down", 429);
    };
    await engine.reconcile();
    expect((await engine.status()).lastError).toBeNull();
    expect((await store.entries())[0].pushed).toBeNull();
    expect(api.listCalls).toEqual([]);
  });

  it("a 409 because the service copy is newer pulls from the start and the service copy wins", async () => {
    const { store, api, state, engine } = setup();
    state.state.collectionsVersion = 50;
    store.add(record({ name: "Mine", updatedAt: "2026-10-23T20:00:00Z" }), null);
    api.put = async () => {
      throw new SyncConflictError("newer");
    };
    api.pages = [{ collections: [{ ...record({ name: "Theirs", updatedAt: "2026-10-23T23:00:00Z" }), version: 60 }], nextVersion: 60, hasMore: false }];
    await engine.reconcile();
    expect(api.listCalls).toEqual([0]);
    expect((await store.list())[0].name).toBe("Theirs");
  });

  it("pruned > 0 pulls that collection back", async () => {
    const { store, api, engine } = setup();
    store.add(record(), null);
    api.put = async () => ({ version: 5, pruned: 1 });
    api.pages = [{ collections: [{ ...record({ items: [] }), version: 5 }], nextVersion: 5, hasMore: false }];
    await engine.reconcile();
    expect(api.listCalls).toEqual([0]);
    expect((await store.list())[0].items).toEqual([]);
  });

  it("409 too_many_collections keeps the local copy unpushed and says so", async () => {
    const { store, api, engine } = setup();
    store.add(record(), null);
    api.put = async () => {
      throw new TooManyCollectionsError("Too many collections");
    };
    await engine.reconcile();
    expect((await store.entries())[0].pushed).toBeNull();
    expect(engine.collectionsSyncProblem()).toBe("too_many_collections");
    expect((await engine.status()).lastError).toBeNull();
  });

  it("binds the store to the account so a new account re-sends everything", async () => {
    const { store, engine } = setup();
    await engine.reconcile();
    expect(store.account).toBe("https://x.test\na@b.c");
  });
});
