import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { LibraryRepository } from "../../src/server/storage/LibraryRepository";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
import type { ReadTagsResult, TagService, WriteTagsInput } from "../../src/server/audio/TagService";
import type { Release, Settings } from "../../src/shared/types";
import { RESENT_RECHECK_MS, SyncEngine } from "../../src/server/sync/SyncEngine";
import { emptySyncState, type SyncState, type SyncStateStore } from "../../src/server/sync/SyncState";
import {
  SyncAuthError,
  SyncConflictError,
  SyncRequestError,
  type MeResult,
  type SpotifyLinkStatus,
  type SyncApi,
  type SyncFileToUpload,
  type SyncUploadTarget,
  type VerifyCodeResult,
} from "../../src/server/sync/SyncApi";
import { toSyncRecord, type SyncRecord } from "../../src/server/sync/SyncRecord";
import type { CollectionsPage } from "../../src/shared/collections";
import { playEventsFilePath } from "../../src/server/config/paths";
import { FilePlayEventStore } from "../../src/server/plays/FilePlayEventStore";
import { FakePlayCountStore } from "./FakePlayCountStore";
import type { PlayEntry, PlayEventWire } from "../../src/server/plays/playsWire";

/** In-memory `SettingsStore` fake, mutable so tests can flip sign-in state. */
class FakeSettingsStore implements SettingsStore {
  constructor(private settings: Settings) {}
  async get(): Promise<Settings> {
    return this.settings;
  }
  async set(settings: Settings): Promise<Settings> {
    this.settings = settings;
    return settings;
  }
  async update(mutator: (current: Settings) => Settings | null): Promise<Settings> {
    const next = mutator(this.settings);
    if (next) this.settings = next;
    return this.settings;
  }
}

/** In-memory `LibraryRepository` fake, scoped by libraryDir like the real one. */
class InMemoryLibraryRepository implements LibraryRepository {
  private byDir = new Map<string, Release[]>();
  async list(libraryDir: string): Promise<Release[]> {
    return this.byDir.get(libraryDir) ?? [];
  }
  async find(libraryDir: string, id: string): Promise<Release | null> {
    return (this.byDir.get(libraryDir) ?? []).find((r) => r.id === id) ?? null;
  }
  async upsert(libraryDir: string, release: Release): Promise<Release> {
    const list = this.byDir.get(libraryDir) ?? [];
    const idx = list.findIndex((r) => r.id === release.id);
    if (idx >= 0) list[idx] = release;
    else list.push(release);
    this.byDir.set(libraryDir, list);
    return release;
  }
  async remove(libraryDir: string, id: string): Promise<Release | null> {
    const list = this.byDir.get(libraryDir) ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const [removed] = list.splice(idx, 1);
    return removed;
  }
}

/** Fake converter that just copies the input file, so no real ffmpeg is needed. */
class CopyingConverter implements AudioConverter {
  async toMp3(inputPath: string, outputPath: string): Promise<void> {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(inputPath, outputPath);
  }
}

/** Fake tag service that records every write call instead of touching ID3 frames. */
class RecordingTagService implements TagService {
  writes: { filePath: string; input: WriteTagsInput }[] = [];
  async write(filePath: string, input: WriteTagsInput): Promise<void> {
    this.writes.push({ filePath, input });
  }
  async read(): Promise<ReadTagsResult> {
    return { title: null, artist: null, album: null, year: null, genre: null, durationSec: 42, hasCover: false };
  }
}

/** In-memory `SyncStateStore` fake. `get()` returns a shallow clone so callers mutate freely before `set()`. */
class FakeSyncStateStore implements SyncStateStore {
  private state: SyncState = emptySyncState();
  async get(): Promise<SyncState> {
    return {
      pushedUpdatedAt: { ...this.state.pushedUpdatedAt },
      uploadedFiles: Object.fromEntries(Object.entries(this.state.uploadedFiles).map(([k, v]) => [k, [...v]])),
      coverHash: { ...this.state.coverHash },
      pendingFromPhone: { ...this.state.pendingFromPhone },
      missingFiles: { ...this.state.missingFiles },
      ...(this.state.lastMissingFilesCheckAt ? { lastMissingFilesCheckAt: this.state.lastMissingFilesCheckAt } : {}),
      hiddenFromTray: { ...this.state.hiddenFromTray },
      localIdQueuedAt: { ...this.state.localIdQueuedAt },
      localIdBackfilled: this.state.localIdBackfilled,
      collectionsVersion: this.state.collectionsVersion,
    };
  }
  async set(state: SyncState): Promise<SyncState> {
    this.state = { ...state, hiddenFromTray: this.state.hiddenFromTray };
    return state;
  }
  async update(mutator: (current: SyncState) => SyncState | null): Promise<SyncState> {
    const next = mutator(await this.get());
    if (next) this.state = next;
    return this.state;
  }
}

/**
 * In-memory `SyncApi` fake standing in for the hosted sync service: tracks
 * every call so tests can assert on them, and lets a test seed remote records
 * (as if pushed by an iOS device) and file blobs (as if already uploaded).
 */
class FakeSyncApi implements SyncApi {
  putCalls: SyncRecord[] = [];
  putAttempts = 0;
  uploadCalls: { name: string; filePath: string }[] = [];
  createUploadsCalls: { id: string; files: SyncFileToUpload[] }[] = [];
  deleteCalls: string[] = [];
  listReleasesCallCount = 0;
  meCallCount = 0;
  downloadUrlCalls: { id: string; name: string }[] = [];
  /** Every accepted `pushPlays` request, in order. */
  playPushes: PlayEntry[][] = [];
  /** "put" / "plays" in the order the calls were accepted, to check plays go after their release. */
  order: string[] = [];
  private failPlayPushCalls = new Map<number, Error>();
  private playPushAttempts = 0;
  /** What the fake reports as `ignored` for every accepted push. */
  ignoredPerPush = 0;
  /** Runs once a push has been accepted and before the reply returns: a sign-out mid-request. */
  afterPlayPush: (() => Promise<void>) | null = null;

  private conflictOnce = new Set<string>();
  private serverRecords = new Map<string, SyncRecord & { version: number }>();
  private version = 0;
  private blobs = new Map<string, Buffer>();

  async requestCode(): Promise<void> {}

  async verifyCode(): Promise<VerifyCodeResult> {
    return { token: "tok", user: { id: "u1", email: "a@b.com" }, device: { id: "d1", name: "dev" } };
  }

  /** What `me()` reports as `resyncRequestedAt` (#218); absent unless a test sets it. */
  meResyncRequestedAt: string | null | undefined = undefined;

  async me(): Promise<MeResult> {
    this.meCallCount++;
    return {
      ...(this.meResyncRequestedAt === undefined ? {} : { resyncRequestedAt: this.meResyncRequestedAt }),
      user: { id: "u1", email: "a@b.com" },
      device: { id: "d1", name: "dev" },
      quota: { usedBytes: 100, limitBytes: 1_000_000_000 },
      devices: [],
    };
  }

  async revokeDevice(): Promise<void> {}

  /** Mirrors the real server: the account, its releases and its version counter are gone;
   * signing in again with the same email starts a fresh, empty account. */
  async deleteAccount(): Promise<void> {
    this.serverRecords.clear();
    this.version = 0;
  }

  /** When set, every `listReleases` call returns this exact page regardless of state, to
   * simulate a misbehaving/hostile server (a page that never advances the cursor). */
  private stalledPage: { releases: (SyncRecord & { version: number })[]; nextVersion: number; hasMore: boolean } | null =
    null;
  private failListReleasesCallNumber: number | null = null;

  async listReleases(sinceVersion: number, limit: number) {
    this.listReleasesCallCount++;
    if (this.failListReleasesCallNumber === this.listReleasesCallCount) {
      throw new Error(`FakeSyncApi: injected failure on listReleases call #${this.listReleasesCallCount}`);
    }
    if (this.stalledPage) return this.stalledPage;
    const all = [...this.serverRecords.values()]
      .filter((r) => r.version > sinceVersion)
      .sort((a, b) => a.version - b.version);
    const page = all.slice(0, limit);
    const hasMore = page.length < all.length;
    const nextVersion = hasMore ? page[page.length - 1].version : this.version;
    return { releases: page, nextVersion, hasMore };
  }

  /** Release ids whose PUT is answered with this error. */
  failPutFor = new Map<string, Error>();

  async putRelease(record: SyncRecord): Promise<{ version: number }> {
    this.putAttempts++;
    const putError = this.failPutFor.get(record.id);
    if (putError) throw putError;
    if (this.conflictOnce.has(record.id)) {
      this.conflictOnce.delete(record.id);
      throw new SyncConflictError("conflict");
    }
    this.putCalls.push(record);
    this.order.push("put");
    this.version++;
    this.serverRecords.set(record.id, { ...record, version: this.version });
    return { version: this.version };
  }

  async deleteRelease(id: string): Promise<{ version: number }> {
    this.deleteCalls.push(id);
    this.version++;
    const existing = this.serverRecords.get(id);
    const base: SyncRecord =
      existing ?? {
        syncVersion: 1,
        id,
        kind: "single",
        title: "",
        artist: "",
        year: null,
        genre: null,
        cover: null,
        tracks: [],
        origin: "mac",
        originDevice: "dev",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deleted: false,
      };
    this.serverRecords.set(id, { ...base, deleted: true, updatedAt: new Date().toISOString(), version: this.version });
    return { version: this.version };
  }

  async createUploads(id: string, files: SyncFileToUpload[]): Promise<{ uploads: SyncUploadTarget[] }> {
    this.createUploadsCalls.push({ id, files });
    return { uploads: files.map((f) => ({ name: f.name, url: `fake://${id}/${f.name}`, method: "PUT", headers: {} })) };
  }

  async downloadUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }> {
    this.downloadUrlCalls.push({ id, name });
    return { url: `fake://${id}/${name}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  async pushPlays(counts: PlayEntry[]) {
    this.playPushAttempts++;
    const injected = this.failPlayPushCalls.get(this.playPushAttempts);
    if (injected) throw injected;
    this.playPushes.push(counts);
    this.order.push("plays");
    await this.afterPlayPush?.();
    return { accepted: counts.length - this.ignoredPerPush, ignored: this.ignoredPerPush };
  }

  /** Every `pushPlayEvents` request that got through (#398), and how the route answers: 200, or an error status. */
  eventPushes: PlayEventWire[][] = [];
  eventsRoute: "ok" | 404 | 429 | 500 = "ok";
  /** Requests that reached `pushPlayEvents`, accepted or not. */
  eventAttempts = 0;
  /** Runs once an events request has been accepted, before the reply returns: an account switch mid-pass. */
  afterEventPush: (() => Promise<void>) | null = null;
  async pushPlayEvents(events: PlayEventWire[]) {
    this.eventAttempts++;
    if (this.eventsRoute !== "ok") throw new SyncRequestError(`events ${this.eventsRoute}`, this.eventsRoute);
    this.eventPushes.push(events);
    await this.afterEventPush?.();
    return { accepted: events.length, ignored: 0 };
  }

  async playEvents(): Promise<never> {
    throw new Error("FakeSyncApi: playEvents is not used by the engine");
  }

  async releasePlays() {
    return { tracks: [] };
  }

  async playsSummary() {
    return { tracks: [], allTime: [], nextCursor: null };
  }

  /** Release ids `GET /v1/files/missing` lists (#172); the fake reports each record's own `updatedAt`. */
  missingIds = new Set<string>();
  /** How the files routes answer: normally, with a 404 (an API from before #170), a 429 or a 500. */
  filesRoutes: "ok" | "old" | "rateLimited" | "down" = "ok";
  /** When set, the exact names `missingFiles()` lists per release id (instead of the one default name). */
  missingNames = new Map<string, string[]>();
  /** What `requestResync()` returns as `resyncRequestedAt`; the real clock when null. */
  resyncAt: string | null = null;
  missingCalls = 0;
  resyncCalls = 0;

  private filesRouteOutcome(): "ok" | "old" {
    if (this.filesRoutes === "rateLimited") throw new SyncRequestError("Too many requests", 429);
    if (this.filesRoutes === "down") throw new SyncRequestError("Sync request failed (500)", 500);
    return this.filesRoutes;
  }

  async missingFiles() {
    this.missingCalls++;
    if (this.filesRouteOutcome() === "old") return null;
    const releases = [...this.missingIds].map((id) => ({
      id,
      missing: this.missingNames.get(id) ?? ["01 - Intro.mp3"],
      recordUpdatedAt: this.serverRecords.get(id)?.updatedAt ?? "",
    }));
    return { releases, checkedAt: new Date().toISOString() };
  }

  async requestResync() {
    this.resyncCalls++;
    if (this.filesRouteOutcome() === "old") return null;
    return { resyncRequestedAt: this.resyncAt ?? new Date().toISOString() };
  }

  async spotifyLinkStart(): Promise<{ authorizeUrl: string }> {
    return { authorizeUrl: "https://accounts.spotify.com/authorize?x=1" };
  }

  async spotifyLinkStatus(): Promise<SpotifyLinkStatus> {
    return { linked: false };
  }

  async spotifyUnlink(): Promise<void> {}

  // Sharing (#182) is tested in SharesEngine.test.ts; here the account has no shares.
  async createShare(): Promise<never> {
    throw new Error("not used here");
  }
  async listSentShares() {
    return { shares: [], nextCursor: null };
  }
  async listReceivedShares() {
    return { shares: [], nextCursor: null };
  }
  async reshareShare(): Promise<never> {
    throw new Error("not used here");
  }
  async revokeShare(): Promise<void> {}
  async shareFileUrl(): Promise<never> {
    throw new Error("not used here");
  }
  async claimShare(): Promise<never> {
    throw new Error("not used here");
  }
  async hideShare(): Promise<void> {}
  async listCollections(): Promise<CollectionsPage> {
    throw new SyncRequestError("Not found", 404);
  }
  async putCollection(): Promise<{ version: number; pruned: number }> {
    throw new SyncRequestError("Not found", 404);
  }
  async deleteCollection(): Promise<{ version: number }> {
    throw new SyncRequestError("Not found", 404);
  }

  async uploadFile(upload: SyncUploadTarget, filePath: string): Promise<void> {
    this.uploadCalls.push({ name: upload.name, filePath });
    const bytes = await fs.readFile(filePath);
    this.blobs.set(this.keyOf(upload.url), bytes);
  }

  async downloadFile(url: string, destPath: string): Promise<void> {
    const bytes = this.blobs.get(this.keyOf(url));
    if (!bytes) throw new Error(`FakeSyncApi: no blob seeded for ${url}`);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, bytes);
  }

  private keyOf(url: string): string {
    return url.replace("fake://", "");
  }

  // --- test helpers ---

  seedRemoteRecord(record: SyncRecord): void {
    this.version++;
    this.serverRecords.set(record.id, { ...record, version: this.version });
  }

  seedBlob(id: string, name: string, bytes: Buffer): void {
    this.blobs.set(`${id}/${name}`, bytes);
  }

  failNextPutWithConflict(id: string): void {
    this.conflictOnce.add(id);
  }

  /** Throws on the given 1-based `pushPlays` call number (counted across the fake's whole life). */
  failPlayPushOnCall(
    callNumber: number,
    error: Error = new Error(`FakeSyncApi: injected failure on pushPlays call #${callNumber}`)
  ): void {
    this.failPlayPushCalls.set(callNumber, error);
  }

  /** Throws on the given 1-based `listReleases` call number (e.g. `2` fails the second page). */
  failListReleasesOnCall(callNumber: number): void {
    this.failListReleasesCallNumber = callNumber;
  }

  /** Makes every subsequent `listReleases` call return a page that reports more data without
   * advancing past `sinceVersion`, as a hostile or buggy server might. */
  stallNonAdvancing(record: SyncRecord & { version: number }, sinceVersion: number): void {
    this.stalledPage = { releases: [record], nextVersion: sinceVersion, hasMore: true };
  }
}

function audioFile(name: string, content = "fake audio bytes"): File {
  return new File([content], name, { type: "audio/mpeg" });
}

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];

function coverFile(extraByte: number): File {
  return new File([new Uint8Array([...JPEG_HEADER, extraByte])], "cover.jpg", { type: "image/jpeg" });
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

describe("SyncEngine", () => {
  let libraryDir: string;
  let settingsStore: FakeSettingsStore;
  let repo: InMemoryLibraryRepository;
  let tags: RecordingTagService;
  let fsSvc: NodeFileSystem;
  let releaseService: ReleaseService;
  let syncState: FakeSyncStateStore;
  let api: FakeSyncApi;
  let engine: SyncEngine;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-engine-"));
    settingsStore = new FakeSettingsStore({
      libraryDir,
      sync: { baseUrl: "http://fake", deviceToken: "tok", email: "a@b.com", lastVersion: 0 },
    });
    repo = new InMemoryLibraryRepository();
    tags = new RecordingTagService();
    fsSvc = new NodeFileSystem();
    releaseService = new ReleaseService(settingsStore, repo, new CopyingConverter(), tags, fsSvc, new ReleaseLayout());
    syncState = new FakeSyncStateStore();
    api = new FakeSyncApi();
    engine = new SyncEngine(settingsStore, syncState, releaseService, fsSvc, () => api, () => "Toby's MacBook");
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  async function importOne(artist = "Artist", title = "Track"): Promise<Release> {
    return releaseService.import(
      { kind: "single", artist, title: "", tracks: [{ title, trackNumber: 1 }] } as never,
      null,
      [audioFile("in.mp3")]
    );
  }

  async function importOneWithCover(extraByte = 1, artist = "Artist", title = "Track"): Promise<Release> {
    return releaseService.import(
      { kind: "single", artist, title: "", tracks: [{ title, trackNumber: 1 }] } as never,
      coverFile(extraByte),
      [audioFile("in.mp3")]
    );
  }

  describe("back-fill when the service refuses a record", () => {
    async function threeReleases(): Promise<Release[]> {
      return [await importOne("A", "One"), await importOne("B", "Two"), await importOne("C", "Three")];
    }

    it.each([400, 422])("skips a release refused with %i and still pushes the others", async (status) => {
      const [a, b, c] = await threeReleases();
      api.failPutFor.set(b.id, new SyncRequestError("refused", status));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await engine.reconcile();
      warn.mockRestore();

      expect(api.putCalls.map((r) => r.id).sort()).toEqual([a.id, c.id].sort());
      expect((await engine.status()).lastError).toBeNull();
    });

    it("still aborts the run on a 500", async () => {
      const [a, b, c] = await threeReleases();
      void a;
      void c;
      api.failPutFor.set(b.id, new SyncRequestError("Sync request failed (500)", 500));

      await engine.reconcile();

      expect((await engine.status()).lastError).toBe("Sync request failed (500)");
    });
  });

  describe("track localIds on adopted releases (#307)", () => {
    let adoptRoot: string;
    let clock: number;

    beforeEach(async () => {
      adoptRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-adopt-"));
      await settingsStore.set({
        libraryDir,
        adoptRoots: [adoptRoot],
        sync: { baseUrl: "http://fake", deviceToken: "tok", email: "a@b.com", lastVersion: 0 },
      });
      clock = Date.UTC(2026, 9, 19, 12, 0, 0);
      engine = new SyncEngine(
        settingsStore,
        syncState,
        releaseService,
        fsSvc,
        () => api,
        () => "Toby's MacBook",
        null,
        () => new Date(clock),
      );
    });

    afterEach(async () => {
      await fs.rm(adoptRoot, { recursive: true, force: true });
    });

    async function adopted(id: string, localId: string | undefined = `spotify:local:A:B:${id}:100`): Promise<Release> {
      const filePath = path.join(adoptRoot, `${id}.mp3`);
      await fs.writeFile(filePath, "x");
      const release: Release = {
        id,
        kind: "single",
        title: id,
        artist: "A",
        year: null,
        genre: null,
        coverPath: null,
        folderPath: adoptRoot,
        tracks: [
          { id: `${id}-t`, title: id, trackNumber: 1, filePath, originalName: `${id}.mp3`, durationSec: 100, ...(localId ? { localId } : {}) },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        adopted: true,
      };
      await repo.upsert(libraryDir, release);
      return release;
    }

    /** What an older server or iPhone hands back: the release without its localIds. */
    function strippedRemote(release: Release, updatedAt = release.updatedAt): SyncRecord {
      const record = toSyncRecord(release, "mac", "Toby's MacBook");
      const tracks = record.tracks.map((t) => {
        const bare = { ...t };
        delete bare.localId;
        return bare;
      });
      return { ...record, updatedAt, tracks };
    }

    it("sends localId on an adopted release's tracks", async () => {
      const r = await adopted("a1");
      await engine.reconcile();
      expect(api.putCalls.find((p) => p.id === r.id)?.tracks[0].localId).toBe("spotify:local:A:B:a1:100");
    });

    it("back-fills every adopted release once, and not again on the next reconcile", async () => {
      const a = await adopted("a1");
      const b = await adopted("a2");
      // Both were pushed before localIds existed.
      await syncState.set({
        ...emptySyncState(),
        pushedUpdatedAt: { [a.id]: a.updatedAt, [b.id]: b.updatedAt },
      });
      await engine.reconcile();
      expect(api.putCalls.map((p) => p.id).sort()).toEqual([a.id, b.id]);
      expect((await syncState.get()).localIdBackfilled).toBe(true);

      api.putCalls.length = 0;
      await engine.reconcile();
      expect(api.putCalls).toEqual([]);
    });

    it("the back-fill skips a refused record and still pushes the others", async () => {
      const a = await adopted("a1");
      const b = await adopted("a2");
      await syncState.set({
        ...emptySyncState(),
        pushedUpdatedAt: { [a.id]: a.updatedAt, [b.id]: b.updatedAt },
      });
      api.failPutFor.set(a.id, new SyncRequestError("refused", 422));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await engine.reconcile();
      warn.mockRestore();
      expect(api.putCalls.map((p) => p.id)).toEqual([b.id]);
      expect((await engine.status()).lastError).toBeNull();
    });

    it("re-pushes once when a pulled adopted record lost the localId, then waits a day", async () => {
      const r = await adopted("a1");
      await engine.reconcile(); // pushed with its localId; the back-fill used this release's one push for the day
      api.putCalls.length = 0;

      // Stripped by the server straight away: still inside that day, so nothing is pushed.
      api.seedRemoteRecord(strippedRemote(r));
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      expect(api.putCalls).toEqual([]);
      clock += 24 * 60 * 60 * 1000 + 1000;

      // A server that strips the field: every pull brings the record back without it.
      api.seedRemoteRecord(strippedRemote(r));
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      expect(api.putCalls.map((p) => p.id)).toEqual([r.id]);

      // Pulled stripped again within the day: no second push.
      api.putCalls.length = 0;
      api.seedRemoteRecord(strippedRemote(r));
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      expect(api.putCalls).toEqual([]);

      // A day later it may go once more.
      clock += 24 * 60 * 60 * 1000 + 1000;
      api.seedRemoteRecord(strippedRemote(r));
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      expect(api.putCalls.map((p) => p.id)).toEqual([r.id]);
    });

    it("keeps the Mac's localId when a pull brings a stripped record", async () => {
      const r = await adopted("a1");
      await engine.reconcile();
      api.seedRemoteRecord(strippedRemote(r, "2026-06-01T00:00:00.000Z"));
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      const after = await repo.find(libraryDir, r.id);
      expect(after?.tracks[0].localId).toBe("spotify:local:A:B:a1:100");
    });

    it("does not queue a push when the pulled record still has the localId", async () => {
      const r = await adopted("a1");
      await engine.reconcile();
      api.putCalls.length = 0;
      await settingsStore.update((cur) => (cur.sync ? { ...cur, sync: { ...cur.sync, lastVersion: 0 } } : null));
      await engine.reconcile();
      expect(api.putCalls).toEqual([]);
      expect(r.id).toBeTruthy();
    });
  });

  it("push uploads missing files then puts the record", async () => {
    const release = await importOne();

    await engine.push(release);

    expect(api.createUploadsCalls).toHaveLength(1);
    expect(api.createUploadsCalls[0].files.map((f) => f.name)).toEqual([path.basename(release.tracks[0].filePath)]);
    expect(api.uploadCalls).toHaveLength(1);
    expect(api.uploadCalls[0].filePath).toBe(release.tracks[0].filePath);
    expect(api.putCalls).toHaveLength(1);
    expect(api.putCalls[0].id).toBe(release.id);
    expect(api.putCalls[0].origin).toBe("mac");
    expect(api.putCalls[0].originDevice).toBe("Toby's MacBook");

    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  it("retries a conflicting put after pulling", async () => {
    const release = await importOne();
    api.failNextPutWithConflict(release.id);
    const listCallsBefore = api.listReleasesCallCount;

    await engine.push(release);

    expect(api.putAttempts).toBe(2);
    expect(api.putCalls).toHaveLength(1); // only the eventually-successful attempt is "put"
    expect(api.listReleasesCallCount).toBeGreaterThan(listCallsBefore);

    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  it("push refuses a release whose track filePath was tampered to point outside the library", async () => {
    const release = await importOne();
    const outsidePath = path.join(os.tmpdir(), "sli-sync-outside-track.mp3");
    await fs.writeFile(outsidePath, "not part of the library");
    const tampered: Release = { ...release, tracks: [{ ...release.tracks[0], filePath: outsidePath }] };

    await engine.push(tampered);

    expect(api.putCalls).toHaveLength(0);
    expect(api.uploadCalls).toHaveLength(0);
    const status = await engine.status();
    expect(status.lastError).toMatch(/outside the library/i);

    await fs.rm(outsidePath, { force: true });
  });

  it("push refuses a release whose coverPath was tampered to point outside the library", async () => {
    const release = await importOneWithCover();
    const outsidePath = path.join(os.tmpdir(), "sli-sync-outside-cover.jpg");
    await fs.writeFile(outsidePath, "not part of the library");
    const tampered: Release = { ...release, coverPath: outsidePath };

    await engine.push(tampered);

    expect(api.putCalls).toHaveLength(0);
    const status = await engine.status();
    expect(status.lastError).toMatch(/outside the library/i);

    await fs.rm(outsidePath, { force: true });
  });

  it("reconcile's backfill skips a release tampered outside the library, but still pushes the rest", async () => {
    const good = await importOne("Good Artist", "Good Track");
    const bad = await importOne("Bad Artist", "Bad Track");
    const outsidePath = path.join(os.tmpdir(), "sli-sync-outside-backfill.mp3");
    await fs.writeFile(outsidePath, "not part of the library");
    // Corrupt the stored index entry directly, the way a hand-edited/hostile library.json would.
    await repo.upsert(libraryDir, { ...bad, tracks: [{ ...bad.tracks[0], filePath: outsidePath }] });

    await engine.reconcile();

    const pushedIds = api.putCalls.map((r) => r.id);
    expect(pushedIds).toContain(good.id);
    expect(pushedIds).not.toContain(bad.id);
    const status = await engine.status();
    expect(status.lastError).toBeNull(); // the bad release is logged and skipped, not surfaced as a run failure

    await fs.rm(outsidePath, { force: true });
  });

  it("offers an iOS record as pending, then imports it with the same id on accept", async () => {
    const iosRecord: SyncRecord = {
      syncVersion: 1,
      id: "ios-release-1",
      kind: "single",
      title: "Phone Song",
      artist: "Phone Artist",
      year: "2025",
      genre: null,
      cover: null,
      tracks: [
        {
          id: "ios-track-1",
          title: "Phone Song",
          trackNumber: 1,
          file: "Phone Artist - Phone Song - 01 - Phone Song.mp3",
          bytes: 9,
          durationSec: 10,
        },
      ],
      origin: "ios",
      originDevice: "Toby's iPhone",
      createdAt: "2026-09-27T10:00:00.000Z",
      updatedAt: "2026-09-27T10:00:00.000Z",
      deleted: false,
    };
    api.seedRemoteRecord(iosRecord);
    api.seedBlob(iosRecord.id, iosRecord.tracks[0].file, Buffer.from("mp3 bytes"));

    await engine.reconcile();

    const statusAfterReconcile = await engine.status();
    expect(statusAfterReconcile.pendingFromPhone).toEqual([
      expect.objectContaining({ id: "ios-release-1", origin: "ios", title: "Phone Song", artist: "Phone Artist", kind: "single", trackCount: 1 }),
    ]);

    const imported = await engine.acceptFromPhone("ios-release-1");
    expect(imported.id).toBe("ios-release-1");
    expect(imported.tracks).toHaveLength(1);
    expect(imported.tracks[0].id).toBe("ios-track-1");
    const exists = await fs
      .access(imported.tracks[0].filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const statusAfterAccept = await engine.status();
    expect(statusAfterAccept.pendingFromPhone).toHaveLength(0);
  });

  it("offers a record from the web or from an origin it has never heard of as pending, labelled by its origin (#185)", async () => {
    const fromOrigin = (id: string, origin: string, originDevice: string): SyncRecord => ({
      syncVersion: 2,
      id,
      kind: "single",
      title: `Song ${id}`,
      artist: "Other Artist",
      year: null,
      genre: null,
      cover: null,
      coverHash: null,
      tracks: [],
      origin,
      originDevice,
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      deleted: false,
    });
    api.seedRemoteRecord(fromOrigin("from-web", "web", "Browser"));
    api.seedRemoteRecord(fromOrigin("from-future", "future-thing", "Gadget"));
    // A record from some other Mac is still not offered, and nothing here is mistaken for this Mac's own.
    api.seedRemoteRecord(fromOrigin("from-other-mac", "mac", "Another Mac"));

    await engine.reconcile();

    const status = await engine.status();
    expect(status.lastError).toBeNull();
    expect(status.pendingFromPhone.map((p) => [p.id, p.origin]).sort()).toEqual([
      ["from-future", "future-thing"],
      ["from-web", "web"],
    ]);
  });

  it("re-tags a local release in place when the remote copy is newer, without renaming", async () => {
    const release = await importOne("Old Artist", "Old Title");
    const originalFilePath = release.tracks[0].filePath;

    const newerRecord = toSyncRecord(release, "ios", "Toby's iPhone");
    newerRecord.title = "New Title";
    newerRecord.tracks[0].title = "New Track Title";
    newerRecord.updatedAt = new Date(Date.now() + 60_000).toISOString();
    api.seedRemoteRecord(newerRecord);

    await engine.reconcile();

    const updated = await releaseService.get(release.id);
    expect(updated?.title).toBe("New Title");
    expect(updated?.tracks[0].title).toBe("New Track Title");
    expect(updated?.tracks[0].filePath).toBe(originalFilePath);

    const lastWrite = tags.writes.at(-1);
    expect(lastWrite?.filePath).toBe(originalFilePath);
    expect(lastWrite?.input.title).toBe("New Track Title");

    // Reconcile already reconciled this release with the remote state, so the
    // back-fill step in the same run must not push it straight back.
    expect(api.putCalls).toHaveLength(0);
  });

  it("still pulls a phone record written between this Mac's last pull and its own push or delete", async () => {
    const phoneRecord = (id: string): SyncRecord => ({
      syncVersion: 1,
      id,
      kind: "single",
      title: "Phone Song",
      artist: "Phone Artist",
      year: null,
      genre: null,
      cover: null,
      tracks: [],
      origin: "ios",
      originDevice: "Toby's iPhone",
      createdAt: "2026-09-27T10:00:00.000Z",
      updatedAt: "2026-09-27T10:00:00.000Z",
      deleted: false,
    });

    // The phone writes version 1 while this Mac has seen nothing; the Mac's
    // own push then lands at version 2.
    api.seedRemoteRecord(phoneRecord("ios-before-push"));
    await engine.push(await importOne("Mac Artist", "Mac Track"));
    // Same again around a delete: phone at version 3, tombstone at version 4.
    const toDelete = await importOne("Other Artist", "Other Track");
    api.seedRemoteRecord(phoneRecord("ios-before-delete"));
    await engine.tombstone(toDelete.id);

    await engine.reconcile();

    const status = await engine.status();
    expect(status.pendingFromPhone.map((p) => p.id).sort()).toEqual(["ios-before-delete", "ios-before-push"]);
  });

  it("deletes a release locally when the remote record is a tombstone", async () => {
    const release = await importOne();
    await engine.push(release);

    const tombstoneRecord = toSyncRecord(release, "mac", "Toby's MacBook");
    tombstoneRecord.deleted = true;
    tombstoneRecord.updatedAt = new Date(Date.now() + 60_000).toISOString();
    api.seedRemoteRecord(tombstoneRecord);

    await engine.reconcile();

    expect(await releaseService.get(release.id)).toBeNull();
    const folderExists = await fs
      .access(release.folderPath)
      .then(() => true)
      .catch(() => false);
    expect(folderExists).toBe(false);
  });

  it("back-fills a local release that was never pushed", async () => {
    const release = await importOne();

    await engine.reconcile();

    expect(api.putCalls).toHaveLength(1);
    expect(api.putCalls[0].id).toBe(release.id);
    expect(api.createUploadsCalls).toHaveLength(1);
  });

  it("finishes a push whose own record comes back newer, instead of treating it as synced", async () => {
    const release = await importOne();
    await engine.push(release);
    const putsAfterPush = api.putCalls.length;

    // What the server hands back after a re-PUT whose uploads then failed.
    const echo = toSyncRecord(release, "mac", "Toby's MacBook");
    echo.updatedAt = new Date(Date.now() + 5_000).toISOString();
    api.seedRemoteRecord(echo);

    await engine.reconcile();

    const local = await releaseService.get(release.id);
    expect(local?.updatedAt).toBe(echo.updatedAt);
    expect(api.putCalls.length).toBe(putsAfterPush + 1);
    expect(api.putCalls.at(-1)?.updatedAt).toBe(echo.updatedAt);

    const putsAfterRetry = api.putCalls.length;
    await engine.reconcile();
    expect(api.putCalls.length).toBe(putsAfterRetry);
  });

  it("does nothing new on a second reconcile with no changes", async () => {
    await importOne();
    await engine.reconcile();

    const putsAfterFirst = api.putCalls.length;
    const uploadsAfterFirst = api.createUploadsCalls.length;

    await engine.reconcile();

    expect(api.putCalls.length).toBe(putsAfterFirst);
    expect(api.createUploadsCalls.length).toBe(uploadsAfterFirst);
  });

  it("ignores overlapping reconcile calls", async () => {
    await importOne();

    await Promise.all([engine.reconcile(), engine.reconcile()]);

    // If both calls had run fully, listReleases would have been called twice.
    expect(api.listReleasesCallCount).toBe(1);
  });

  it("does nothing when signed out", async () => {
    await settingsStore.set({ libraryDir, sync: null });
    const release = await importOne();

    await engine.push(release);
    await engine.reconcile();

    expect(api.putCalls).toHaveLength(0);
    expect(api.listReleasesCallCount).toBe(0);
  });

  it("push re-uploads the cover after its bytes change even though uploadedFiles already lists it", async () => {
    const release = await importOneWithCover(1);
    await engine.push(release);
    expect(api.uploadCalls.map((u) => u.name)).toContain("cover.jpg");

    const updated = await releaseService.replaceCover(release.id, coverFile(2));
    await engine.push(updated);

    const coverUploads = api.uploadCalls.filter((u) => u.name === "cover.jpg");
    expect(coverUploads).toHaveLength(2);

    const expectedHash = sha256Hex(await fs.readFile(updated.coverPath!));
    const state = await syncState.get();
    expect(state.coverHash[release.id]).toBe(expectedHash);
  });

  it("pull downloads and re-embeds a replaced cover when the remote coverHash differs", async () => {
    const release = await importOneWithCover(1);
    await engine.push(release);

    const newCoverBytes = Buffer.from([...JPEG_HEADER, 9]);
    const newHash = sha256Hex(newCoverBytes);
    const remoteRecord = toSyncRecord(release, "ios", "Toby's iPhone");
    remoteRecord.updatedAt = new Date(Date.now() + 60_000).toISOString();
    remoteRecord.coverHash = newHash;
    api.seedRemoteRecord(remoteRecord);
    api.seedBlob(release.id, "cover.jpg", newCoverBytes);

    await engine.reconcile();

    const updated = await releaseService.get(release.id);
    expect(updated?.coverPath).toBeTruthy();
    const onDisk = await fs.readFile(updated!.coverPath!);
    expect(onDisk.equals(newCoverBytes)).toBe(true);

    const lastWrite = tags.writes.filter((w) => w.filePath === updated!.tracks[0].filePath).at(-1);
    expect(lastWrite?.input.coverPath).toBe(updated!.coverPath);

    const state = await syncState.get();
    expect(state.coverHash[release.id]).toBe(newHash);
    expect(state.uploadedFiles[release.id]).toContain("cover.jpg");

    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  it("pull makes no download when the remote coverHash matches the local one", async () => {
    const release = await importOneWithCover(1);
    const localHash = sha256Hex(await fs.readFile(release.coverPath!));

    const remoteRecord = toSyncRecord(release, "ios", "Toby's iPhone");
    remoteRecord.updatedAt = new Date(Date.now() + 60_000).toISOString();
    remoteRecord.title = "New Title";
    remoteRecord.coverHash = localHash;
    api.seedRemoteRecord(remoteRecord);
    // No blob seeded for "cover.jpg" - a download attempt would fail and surface as lastError.

    await engine.reconcile();

    expect(api.downloadUrlCalls).toHaveLength(0);
    const updated = await releaseService.get(release.id);
    expect(updated?.title).toBe("New Title");
    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  it("pull leaves the cover alone for a syncVersion 1 record with no coverHash", async () => {
    const release = await importOneWithCover(1);
    const originalBytes = await fs.readFile(release.coverPath!);

    const v1Record: SyncRecord = {
      syncVersion: 1,
      id: release.id,
      kind: "single",
      title: "Retitled",
      artist: release.artist,
      year: release.year,
      genre: release.genre,
      cover: "cover.jpg",
      tracks: [
        {
          id: release.tracks[0].id,
          title: release.tracks[0].title,
          trackNumber: 1,
          file: path.basename(release.tracks[0].filePath),
          bytes: 9,
          durationSec: null,
        },
      ],
      origin: "ios",
      originDevice: "Toby's iPhone",
      createdAt: release.createdAt,
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
      deleted: false,
    };
    api.seedRemoteRecord(v1Record);

    await engine.reconcile();

    expect(api.downloadUrlCalls).toHaveLength(0);
    const updated = await releaseService.get(release.id);
    expect(updated?.title).toBe("Retitled");
    const onDisk = await fs.readFile(updated!.coverPath!);
    expect(onDisk.equals(originalBytes)).toBe(true);
    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  it("retries a failed cover download on the next reconcile, then succeeds", async () => {
    // Deliberately not pushed first: pushing would upload "cover.jpg" to the fake
    // API's blob store, and a later download of that same name would then
    // "succeed" with those (stale) bytes instead of genuinely failing.
    const release = await importOneWithCover(1);

    const newBytes = Buffer.from([...JPEG_HEADER, 42]);
    const newHash = sha256Hex(newBytes);
    const remoteRecord = toSyncRecord(release, "ios", "Toby's iPhone");
    remoteRecord.updatedAt = new Date(Date.now() + 60_000).toISOString();
    remoteRecord.coverHash = newHash;
    api.seedRemoteRecord(remoteRecord);
    // No blob seeded yet - simulates the phone not having finished uploading the cover.

    await engine.reconcile();

    const afterFail = await releaseService.get(release.id);
    expect(afterFail?.title).toBe(release.title);
    const statusAfterFail = await engine.status();
    expect(statusAfterFail.lastError).toBeTruthy();

    api.seedBlob(release.id, "cover.jpg", newBytes);
    await engine.reconcile();

    const afterRetry = await releaseService.get(release.id);
    const onDisk = await fs.readFile(afterRetry!.coverPath!);
    expect(onDisk.equals(newBytes)).toBe(true);
    const state = await syncState.get();
    expect(state.coverHash[release.id]).toBe(newHash);
    const statusAfterRetry = await engine.status();
    expect(statusAfterRetry.lastError).toBeNull();
  });

  it("re-pushes a release after the account is deleted and signed back in", async () => {
    const release = await importOne();
    await engine.push(release);
    expect(api.putCalls).toHaveLength(1);

    // Same local-state reset `DELETE /api/sync/account` performs: clear the
    // stored token/email/version and empty the sync state, the way sign-out
    // and account deletion both do.
    const settingsBeforeDelete = await settingsStore.get();
    await settingsStore.set({
      ...settingsBeforeDelete,
      sync: settingsBeforeDelete.sync ? { ...settingsBeforeDelete.sync, deviceToken: null, email: null, lastVersion: 0 } : null,
    });
    await syncState.set(emptySyncState());

    // Sign back in to a new, empty account (same email, new token).
    const settingsAfterDelete = await settingsStore.get();
    await settingsStore.set({
      ...settingsAfterDelete,
      sync: { baseUrl: "http://fake", deviceToken: "tok-2", email: "a@b.com", lastVersion: 0 },
    });

    await engine.reconcile();

    const pushedIds = api.putCalls.map((r) => r.id);
    expect(pushedIds).toContain(release.id);
    expect(api.putCalls.length).toBeGreaterThan(1);
    const status = await engine.status();
    expect(status.lastError).toBeNull();
  });

  describe("files missing from a phone release (#172)", () => {
    const MIN = 60_000;
    const NOW = Date.parse("2026-10-15T12:00:00.000Z");
    let nowMs: number;
    let clocked: SyncEngine;

    beforeEach(() => {
      nowMs = NOW;
      clocked = new SyncEngine(settingsStore, syncState, releaseService, fsSvc, () => api, () => "Toby's MacBook", null, () => new Date(nowMs));
    });

    function phoneRecord(id: string, updatedAt: string, origin = "ios"): SyncRecord {
      return {
        syncVersion: 2,
        id,
        kind: "single",
        title: `Song ${id}`,
        artist: "Phone Artist",
        year: null,
        genre: null,
        cover: null,
        coverHash: null,
        tracks: [{ id: `${id}-t1`, title: `Song ${id}`, trackNumber: 1, file: `${id}.mp3`, bytes: 9, durationSec: 10 }],
        origin,
        originDevice: "Toby's iPhone",
        createdAt: updatedAt,
        updatedAt,
        deleted: false,
      };
    }

    /** A record the phone wrote `agoMs` before the fake clock's now. */
    function seedPhone(id: string, agoMs: number, origin = "ios"): void {
      api.seedRemoteRecord(phoneRecord(id, new Date(NOW - agoMs).toISOString(), origin));
      api.seedBlob(id, `${id}.mp3`, Buffer.from("mp3 bytes"));
    }

    async function stateOf(id: string) {
      const status = await clocked.status();
      expect(status.lastError).toBeNull();
      return status.pendingFromPhone.find((p) => p.id === id)?.filesState;
    }

    it("is normal when the release is not in the missing list, and Send to Spotify works", async () => {
      seedPhone("a", 5 * MIN);

      await clocked.reconcile();

      expect(api.missingCalls).toBe(1);
      expect(await stateOf("a")).toBeUndefined();
      const release = await clocked.acceptFromPhone("a");
      expect(release.id).toBe("a");
    });

    it("is 'arriving' the first time a young record is missing, and quiet about it", async () => {
      seedPhone("a", 5 * MIN);
      api.missingIds.add("a");

      await clocked.reconcile();

      expect(await stateOf("a")).toBe("arriving");
      expect((await syncState.get()).missingFiles.a).toEqual({
        firstSeenMissingAt: new Date(NOW).toISOString(),
        stillMissing: false,
      });
    });

    it("is 'waiting' once a later reconcile still finds the files missing", async () => {
      seedPhone("a", 5 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("arriving");

      nowMs += 10 * MIN;
      await clocked.reconcile();

      expect(api.missingCalls).toBe(2);
      expect(await stateOf("a")).toBe("waiting");
      // The first sighting is kept, not restarted.
      expect((await syncState.get()).missingFiles.a).toEqual({
        firstSeenMissingAt: new Date(NOW).toISOString(),
        stillMissing: true,
      });
    });

    it("is 'waiting' straight away when the record is already an hour old on first sight", async () => {
      seedPhone("old", 61 * MIN);
      seedPhone("young", 59 * MIN);
      api.missingIds.add("old").add("young");

      await clocked.reconcile();

      expect(await stateOf("old")).toBe("waiting");
      expect(await stateOf("young")).toBe("arriving");
    });

    it("turns 'arriving' into 'waiting' when the record reaches an hour, with no new check", async () => {
      seedPhone("a", 30 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("arriving");

      nowMs += 29 * MIN; // 59 minutes old
      expect(await stateOf("a")).toBe("arriving");
      nowMs += 1 * MIN; // an hour old
      expect(await stateOf("a")).toBe("waiting");
      expect(api.missingCalls).toBe(1);
    });

    it("returns to normal when the files land: the next check no longer lists the release", async () => {
      seedPhone("a", 90 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("waiting");

      api.missingIds.delete("a");
      nowMs += 10 * MIN;
      await clocked.reconcile();

      expect(await stateOf("a")).toBeUndefined();
      expect((await syncState.get()).missingFiles).toEqual({});
      const release = await clocked.acceptFromPhone("a");
      expect(release.id).toBe("a");
    });

    it("judges each release on its own", async () => {
      seedPhone("fine", 5 * MIN);
      seedPhone("late", 5 * MIN);
      api.missingIds.add("late");
      await clocked.reconcile();
      nowMs += 10 * MIN;
      seedPhone("new", 2 * MIN);
      api.missingIds.add("new");
      await clocked.reconcile();

      expect(await stateOf("fine")).toBeUndefined();
      expect(await stateOf("late")).toBe("waiting");
      expect(await stateOf("new")).toBe("arriving");
    });

    it("checks at most every 10 minutes", async () => {
      seedPhone("a", 5 * MIN);
      api.missingIds.add("a");

      await clocked.reconcile();
      nowMs += 4 * MIN;
      await clocked.reconcile();
      nowMs += 5 * MIN + 59_000; // 9 min 59 s since the check
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);
      expect(await stateOf("a")).toBe("arriving"); // reconciles in between are not "later" checks

      nowMs += 1_000; // 10 minutes
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);
      expect(await stateOf("a")).toBe("waiting");
    });

    it("checks again straight away if the clock moves back", async () => {
      seedPhone("a", 5 * MIN);
      await clocked.reconcile();
      nowMs -= 3 * 60 * MIN;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);
    });

    it("makes no check at all while nothing is pending, even across many reconciles", async () => {
      await importOne();
      await clocked.reconcile();
      nowMs += 30 * MIN;
      await clocked.reconcile();
      nowMs += 30 * MIN;
      await clocked.reconcile();

      // The tray makes no check; the one call is the Mac's own first self-heal (#218), 6 h apart.
      expect(api.missingCalls).toBe(1);
      expect((await clocked.status()).lastError).toBeNull();
    });

    it("does not check a pending release the user has since sent", async () => {
      seedPhone("a", 5 * MIN);
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);
      await clocked.acceptFromPhone("a");

      nowMs += 20 * MIN;
      await clocked.reconcile();

      expect(api.missingCalls).toBe(1);
    });

    it("an API from before #170 (404) changes nothing: no state, no error line, today's tray", async () => {
      seedPhone("a", 5 * MIN);
      seedPhone("b", 3 * 60 * MIN);
      api.filesRoutes = "old";

      await clocked.reconcile();

      const status = await clocked.status();
      expect(status.lastError).toBeNull();
      expect(status.pendingFromPhone.map((p) => [p.id, "filesState" in p])).toEqual([
        ["a", false],
        ["b", false],
      ]);
      expect((await syncState.get()).missingFiles).toEqual({});
      // Send still goes down the old path, whose own 404 mapping stays the fallback.
      await expect(clocked.acceptFromPhone("a")).resolves.toMatchObject({ id: "a" });
    });

    it("drops marks when the service stops answering the check (rolled back to an old API)", async () => {
      seedPhone("a", 90 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("waiting");

      api.filesRoutes = "old";
      nowMs += 10 * MIN;
      await clocked.reconcile();

      expect(await stateOf("a")).toBeUndefined();
    });

    it("a 429 on the check is a quiet skip: states kept, no error, retried at the next eligible check", async () => {
      seedPhone("a", 5 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("arriving");

      api.filesRoutes = "rateLimited";
      nowMs += 10 * MIN;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);
      expect(await stateOf("a")).toBe("arriving"); // not pushed to waiting by a check that never answered

      nowMs += 5 * MIN; // not eligible yet: no hammering a rate-limited route
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);

      api.filesRoutes = "ok";
      nowMs += 5 * MIN; // eligible again
      await clocked.reconcile();
      expect(api.missingCalls).toBe(3);
      expect(await stateOf("a")).toBe("waiting");
    });

    it("a failing check never fails the reconcile", async () => {
      seedPhone("a", 5 * MIN);
      api.filesRoutes = "down";

      await clocked.reconcile();

      expect((await clocked.status()).lastError).toBeNull();
      expect(api.missingCalls).toBe(1);
      expect(await stateOf("a")).toBeUndefined();
    });

    it("never sends a waiting release: no downloads, a friendly message, still in the tray", async () => {
      seedPhone("a", 90 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("waiting");

      await expect(clocked.acceptFromPhone("a")).rejects.toThrow(/audio hasn't arrived yet/i);

      expect(api.downloadUrlCalls).toEqual([]);
      expect((await clocked.status()).pendingFromPhone.map((p) => p.id)).toEqual(["a"]);
    });

    it("refuses an 'arriving' release with the phone message, or a generic one for another origin", async () => {
      seedPhone("a", 5 * MIN);
      seedPhone("w", 5 * MIN, "web");
      api.missingIds.add("a").add("w");
      await clocked.reconcile();
      expect(await stateOf("a")).toBe("arriving");

      await expect(clocked.acceptFromPhone("a")).rejects.toThrow("Your phone is still sending this one.");
      await expect(clocked.acceptFromPhone("w")).rejects.toThrow("That device is still sending this one.");
      expect(api.downloadUrlCalls).toEqual([]);
      expect((await clocked.status()).pendingFromPhone.map((p) => p.id)).toEqual(["a", "w"]);
    });

    it("keeps the old 404 message as the fallback for a release not marked missing", async () => {
      seedPhone("b", 5 * MIN);
      await clocked.reconcile();
      api.downloadFile = async () => {
        throw new Error("Download failed (404) for b.mp3");
      };
      await expect(clocked.acceptFromPhone("b")).rejects.toThrow(/hasn't finished uploading this song yet/);
    });

    it("keeps the first-seen marks through the state store, so a restart does not forget them", async () => {
      seedPhone("a", 5 * MIN);
      api.missingIds.add("a");
      await clocked.reconcile();

      const afterRestart = new SyncEngine(settingsStore, syncState, releaseService, fsSvc, () => api, () => "Toby's MacBook", null, () => new Date(nowMs + 10 * MIN));
      await afterRestart.reconcile();

      const status = await afterRestart.status();
      expect(status.pendingFromPhone.find((p) => p.id === "a")?.filesState).toBe("waiting");
    });

    describe("Resync Mac and phone", () => {
      it("reconciles now, then asks the other devices", async () => {
        seedPhone("a", 90 * MIN);
        api.missingIds.add("a");
        const listsBefore = api.listReleasesCallCount;

        const result = await clocked.resync();

        expect(result).toEqual({ asked: true });
        expect(api.listReleasesCallCount).toBeGreaterThan(listsBefore);
        expect(api.resyncCalls).toBe(1);
        expect((await clocked.status()).lastError).toBeNull();
      });

      it("reconciles before it asks", async () => {
        const order: string[] = [];
        const list = api.listReleases.bind(api);
        api.listReleases = async (...args) => {
          order.push("reconcile");
          return list(...args);
        };
        const ask = api.requestResync.bind(api);
        api.requestResync = async () => {
          order.push("ask");
          return ask();
        };

        await clocked.resync();

        expect(order).toEqual(["reconcile", "ask"]);
      });

      it("on a 429 still reconciles, and says it did not ask, with no error", async () => {
        api.filesRoutes = "rateLimited";
        const listsBefore = api.listReleasesCallCount;

        const result = await clocked.resync();

        expect(result).toEqual({ asked: false });
        expect(api.listReleasesCallCount).toBeGreaterThan(listsBefore);
        expect(api.resyncCalls).toBe(1);
        expect((await clocked.status()).lastError).toBeNull();
      });

      it("on a 404 (an API from before #170) says it did not ask, with no error", async () => {
        api.filesRoutes = "old";

        await expect(clocked.resync()).resolves.toEqual({ asked: false });
        expect((await clocked.status()).lastError).toBeNull();
      });

      it("fails with the service's message on any other error", async () => {
        api.filesRoutes = "down";

        await expect(clocked.resync()).rejects.toThrow(/500/);
      });

      it("needs a sign-in, and touches nothing without one", async () => {
        await settingsStore.set({ libraryDir, sync: null });

        await expect(clocked.resync()).rejects.toThrow(/sign in/i);
        expect(api.resyncCalls).toBe(0);
        expect(api.listReleasesCallCount).toBe(0);
      });

      it("checks the missing files right away, even within 10 minutes of the last check", async () => {
        seedPhone("a", 90 * MIN);
        api.missingIds.add("a");
        await clocked.reconcile();
        expect(await stateOf("a")).toBe("waiting");

        api.missingIds.delete("a"); // the phone re-uploaded
        nowMs += MIN;
        await clocked.resync();
        expect(api.missingCalls).toBe(2);
        expect(await stateOf("a")).toBeUndefined();
      });
    });

    describe("a release the phone sends again", () => {
      /** A waiting release, then the phone re-pushes it (the server version bumps). */
      async function resendWaiting(): Promise<void> {
        seedPhone("a", 90 * MIN);
        api.missingIds.add("a");
        await clocked.reconcile();
        expect(await stateOf("a")).toBe("waiting");
        nowMs += MIN;
        seedPhone("a", MIN); // same id, newer record
      }

      it("is not fooled by the same version pulled again: a waiting row stays waiting", async () => {
        seedPhone("a", 90 * MIN);
        api.missingIds.add("a");
        await clocked.reconcile();
        expect(await stateOf("a")).toBe("waiting");

        // The same page comes down again, as if the cursor had not been saved.
        const settings = await settingsStore.get();
        await settingsStore.set({ ...settings, sync: { ...settings.sync!, lastVersion: 0 } });
        nowMs += MIN;
        await clocked.reconcile();

        expect(await stateOf("a")).toBe("waiting");
        expect((await syncState.get()).missingFiles.a?.resentAt).toBeUndefined();
      });

      it("shows as arriving with a resentAt mark, and the next check is due 2 minutes later, not before", async () => {
        await resendWaiting();
        await clocked.reconcile();

        expect(await stateOf("a")).toBe("arriving");
        expect((await syncState.get()).missingFiles.a).toEqual({
          firstSeenMissingAt: new Date(nowMs).toISOString(),
          stillMissing: false,
          resentAt: new Date(nowMs).toISOString(),
        });
        expect(api.missingCalls).toBe(1);

        nowMs += RESENT_RECHECK_MS - 1_000;
        await clocked.reconcile();
        expect(api.missingCalls).toBe(1);

        nowMs += 1_000;
        await clocked.reconcile();
        expect(api.missingCalls).toBe(2);
      });

      it("stays arriving when the early check still lists it, and waits only after the usual gap", async () => {
        await resendWaiting();
        await clocked.reconcile();
        nowMs += RESENT_RECHECK_MS;
        await clocked.reconcile();
        expect(api.missingCalls).toBe(2);
        expect(await stateOf("a")).toBe("arriving");

        nowMs += 10 * MIN;
        await clocked.reconcile();
        expect(api.missingCalls).toBe(3);
        expect(await stateOf("a")).toBe("waiting");
      });

      it("returns to normal and can be sent once the files land", async () => {
        await resendWaiting();
        await clocked.reconcile();
        api.missingIds.delete("a");
        nowMs += RESENT_RECHECK_MS;
        await clocked.reconcile();

        expect(await stateOf("a")).toBeUndefined();
        await expect(clocked.acceptFromPhone("a")).resolves.toMatchObject({ id: "a" });
      });

      it("counts the one-hour rule from the re-send, not from the record's age", async () => {
        await resendWaiting();
        await clocked.reconcile();
        nowMs += 59 * MIN;
        expect(await stateOf("a")).toBe("arriving");
        nowMs += MIN;
        expect(await stateOf("a")).toBe("waiting");
      });

      it("does not touch a release that had no missing mark", async () => {
        seedPhone("a", 5 * MIN);
        await clocked.reconcile();
        seedPhone("a", MIN);
        await clocked.reconcile();
        expect(await stateOf("a")).toBeUndefined();
        expect((await syncState.get()).missingFiles).toEqual({});
      });
    });
  });

  describe("the Mac re-sends its own releases' missing files (#218)", () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const NOW = Date.parse("2026-10-15T12:00:00.000Z");
    let nowMs: number;
    let clocked: SyncEngine;

    function engineOn(): SyncEngine {
      return new SyncEngine(settingsStore, syncState, releaseService, fsSvc, () => api, () => "Toby's MacBook", null, () => new Date(nowMs));
    }

    beforeEach(() => {
      nowMs = NOW;
      clocked = engineOn();
    });

    /** Imports a release, pushes it, and runs a first reconcile so the first-time heal is out of the way. */
    async function pushedRelease(withCover = false): Promise<Release> {
      const release = withCover ? await importOneWithCover() : await importOne();
      await clocked.reconcile();
      expect((await clocked.status()).lastError).toBeNull();
      api.putCalls.length = 0;
      api.uploadCalls.length = 0;
      api.createUploadsCalls.length = 0;
      return release;
    }

    const trackName = (r: Release) => path.basename(r.tracks[0].filePath);

    it("drops only the listed names, then uploads exactly those and marks the release pushed again", async () => {
      const release = await pushedRelease(true);
      const before = await syncState.get();
      expect(before.uploadedFiles[release.id]).toContain(trackName(release));
      expect(before.uploadedFiles[release.id]).toHaveLength(2);
      api.missingNames.set(release.id, [trackName(release)]);
      api.missingIds.add(release.id);
      nowMs += 6 * HOUR;

      await clocked.reconcile();

      expect((await clocked.status()).lastError).toBeNull();
      expect(api.createUploadsCalls).toHaveLength(1);
      expect(api.createUploadsCalls[0].files.map((f) => f.name)).toEqual([trackName(release)]);
      expect(api.uploadCalls.map((u) => u.filePath)).toEqual([release.tracks[0].filePath]);
      const after = await syncState.get();
      expect([...after.uploadedFiles[release.id]].sort()).toEqual([...before.uploadedFiles[release.id]].sort());
      expect(after.coverHash[release.id]).toBe(before.coverHash[release.id]);
      expect(after.pushedUpdatedAt[release.id]).toBe(release.updatedAt);
    });

    it("clears the cover hash for a listed cover and uploads the cover again", async () => {
      const release = await pushedRelease(true);
      const coverName = path.basename(release.coverPath as string);
      api.missingNames.set(release.id, [coverName]);
      api.missingIds.add(release.id);
      nowMs += 6 * HOUR;

      await clocked.reconcile();

      expect(api.createUploadsCalls[0].files.map((f) => f.name)).toEqual([coverName]);
      expect(api.uploadCalls.map((u) => u.filePath)).toEqual([release.coverPath]);
      expect((await syncState.get()).coverHash[release.id]).toBeTruthy();
    });

    it("leaves a listed release that is not in the library untouched", async () => {
      await pushedRelease();
      api.missingIds.add("phone-only");
      nowMs += 6 * HOUR;
      const before = await syncState.get();

      await clocked.reconcile();

      const after = await syncState.get();
      expect(after.uploadedFiles["phone-only"]).toBeUndefined();
      expect(after.pushedUpdatedAt["phone-only"]).toBeUndefined();
      expect(after.coverHash["phone-only"]).toBeUndefined();
      expect({ ...after, lastMissingFilesCheckAt: undefined }).toEqual({ ...before, lastMissingFilesCheckAt: undefined });
      expect(api.createUploadsCalls).toHaveLength(0);
    });

    it("leaves a release the server holds in a newer version alone", async () => {
      const release = await pushedRelease();
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      api.missingFiles = async () => {
        api.missingCalls++;
        return {
          releases: [
            { id: release.id, missing: [trackName(release)], recordUpdatedAt: new Date(NOW + 365 * 24 * HOUR).toISOString() },
          ],
          checkedAt: new Date(nowMs).toISOString(),
        };
      };
      const before = await syncState.get();
      nowMs += 6 * HOUR;

      await clocked.reconcile();

      expect((await clocked.status()).lastError).toBeNull();
      expect((await syncState.get()).uploadedFiles[release.id]).toEqual(before.uploadedFiles[release.id]);
      expect(api.createUploadsCalls).toHaveLength(0);
      expect(info).toHaveBeenCalled();
      info.mockRestore();
    });

    it("leaves a release whose track file is gone from disk alone, and the reconcile still succeeds", async () => {
      const release = await pushedRelease();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      api.missingNames.set(release.id, [trackName(release)]);
      api.missingIds.add(release.id);
      await fs.rm(release.tracks[0].filePath);
      const before = await syncState.get();
      nowMs += 6 * HOUR;

      await clocked.reconcile();

      expect((await clocked.status()).lastError).toBeNull();
      expect((await syncState.get()).uploadedFiles[release.id]).toEqual(before.uploadedFiles[release.id]);
      expect((await syncState.get()).pushedUpdatedAt[release.id]).toBe(release.updatedAt);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("re-sends an adopted release's cover although its audio is gone from disk, but not when the cover is gone", async () => {
      const adoptRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-adopt-"));
      const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-config-"));
      const priorConfigDir = process.env.LOCALLY_CONFIG_DIR;
      process.env.LOCALLY_CONFIG_DIR = configDir;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await settingsStore.set({
          libraryDir,
          adoptRoots: [adoptRoot],
          sync: { baseUrl: "http://fake", deviceToken: "tok", email: "a@b.com", lastVersion: 0 },
        });
        const filePath = path.join(adoptRoot, "song.mp3");
        const coverPath = path.join(configDir, "adopted-covers", "song.jpg");
        await fs.mkdir(path.dirname(coverPath), { recursive: true });
        await fs.writeFile(filePath, "x");
        await fs.writeFile(coverPath, new Uint8Array([...JPEG_HEADER, 1]));
        const release: Release = {
          id: "adopted-1",
          kind: "single",
          title: "Song",
          artist: "A",
          year: null,
          genre: null,
          coverPath,
          folderPath: adoptRoot,
          tracks: [{ id: "adopted-1-t", title: "Song", trackNumber: 1, filePath, originalName: "song.mp3", durationSec: 100 }],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          adopted: true,
        };
        await repo.upsert(libraryDir, release);
        await clocked.reconcile();
        expect((await clocked.status()).lastError).toBeNull();
        api.createUploadsCalls.length = 0;
        api.uploadCalls.length = 0;
        api.missingNames.set(release.id, ["song.jpg"]);
        api.missingIds.add(release.id);
        await fs.rm(filePath);
        nowMs += 6 * HOUR;

        await clocked.reconcile();

        expect((await clocked.status()).lastError).toBeNull();
        expect(api.createUploadsCalls[0].files.map((f) => f.name)).toEqual(["song.jpg"]);
        expect(api.uploadCalls.map((u) => u.filePath)).toEqual([coverPath]);

        api.createUploadsCalls.length = 0;
        await fs.rm(coverPath);
        nowMs += 6 * HOUR;

        await clocked.reconcile();

        expect(api.createUploadsCalls).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("not re-sending release adopted-1: a file is missing on disk"));
      } finally {
        warn.mockRestore();
        if (priorConfigDir === undefined) delete process.env.LOCALLY_CONFIG_DIR;
        else process.env.LOCALLY_CONFIG_DIR = priorConfigDir;
        await fs.rm(adoptRoot, { recursive: true, force: true });
        await fs.rm(configDir, { recursive: true, force: true });
      }
    });

    it("checks at most every 6 hours", async () => {
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);

      nowMs += HOUR;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);

      nowMs += 5 * HOUR;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);
    });

    it("a newer resyncRequestedAt from me() bypasses the spacing, and the same value does not run it again", async () => {
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);

      nowMs += 5 * MIN;
      api.meResyncRequestedAt = new Date(nowMs + 2 * MIN).toISOString(); // the service clock runs ahead
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);

      nowMs += 1 * MIN;
      await clocked.reconcile();
      nowMs += 30_000;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(2);
    });

    it("a new engine on the same state store respects the stored time", async () => {
      await clocked.reconcile();
      expect(api.missingCalls).toBe(1);
      expect((await syncState.get()).lastMissingFilesCheckAt).toBe(new Date(NOW).toISOString());

      nowMs += HOUR;
      const restarted = engineOn();
      await restarted.reconcile();
      expect(api.missingCalls).toBe(1);

      nowMs += 5 * HOUR;
      await engineOn().reconcile();
      expect(api.missingCalls).toBe(2);
    });

    it("makes one call when the tray and the heal are both due, and both apply", async () => {
      const release = await pushedRelease();
      nowMs += 6 * HOUR;
      api.seedRemoteRecord({
        syncVersion: 2,
        id: "ph",
        kind: "single",
        title: "Song",
        artist: "Phone Artist",
        year: null,
        genre: null,
        cover: null,
        coverHash: null,
        tracks: [{ id: "ph-t1", title: "Song", trackNumber: 1, file: "ph.mp3", bytes: 9, durationSec: 10 }],
        origin: "ios",
        originDevice: "Toby's iPhone",
        createdAt: new Date(nowMs - 5 * MIN).toISOString(),
        updatedAt: new Date(nowMs - 5 * MIN).toISOString(),
        deleted: false,
      });
      api.missingIds.add("ph").add(release.id);
      api.missingNames.set(release.id, [trackName(release)]);
      const callsBefore = api.missingCalls;

      await clocked.reconcile();

      expect(api.missingCalls).toBe(callsBefore + 1);
      expect((await syncState.get()).missingFiles.ph).toEqual({
        firstSeenMissingAt: new Date(nowMs).toISOString(),
        stillMissing: false,
      });
      expect(api.uploadCalls.map((u) => u.filePath)).toEqual([release.tracks[0].filePath]);
    });

    it("a 429 changes nothing, shows no error, is not retried 30 s later, but is after 10 minutes", async () => {
      const release = await pushedRelease();
      const before = await syncState.get();
      api.filesRoutes = "rateLimited";
      nowMs += 6 * HOUR;

      await clocked.reconcile();
      const calls = api.missingCalls;
      expect((await clocked.status()).lastError).toBeNull();
      expect(await syncState.get()).toEqual(before);

      nowMs += 30_000;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(calls);

      nowMs += 10 * MIN;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(calls + 1);
      expect((await clocked.status()).lastError).toBeNull();
      expect((await syncState.get()).pushedUpdatedAt[release.id]).toBe(release.updatedAt);
    });

    it("a 404 leaves the releases unchanged with no error and waits 6 hours", async () => {
      const release = await pushedRelease();
      const before = await syncState.get();
      api.filesRoutes = "old";
      nowMs += 6 * HOUR;

      await clocked.reconcile();

      expect((await clocked.status()).lastError).toBeNull();
      const after = await syncState.get();
      expect(after.uploadedFiles[release.id]).toEqual(before.uploadedFiles[release.id]);
      expect(after.lastMissingFilesCheckAt).toBe(new Date(nowMs).toISOString());
      const calls = api.missingCalls;
      nowMs += HOUR;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(calls);
    });

    it("Resync heals in its own reconcile inside the 6 h window, and the next reconcile makes no second call", async () => {
      const release = await pushedRelease();
      api.missingNames.set(release.id, [trackName(release)]);
      api.missingIds.add(release.id);
      nowMs += HOUR;
      api.resyncAt = new Date(nowMs).toISOString();
      const calls = api.missingCalls;

      await expect(clocked.resync()).resolves.toEqual({ asked: true });

      expect(api.missingCalls).toBe(calls + 1);
      expect(api.uploadCalls.map((u) => u.filePath)).toEqual([release.tracks[0].filePath]);

      // The Mac's own nudge, as the service would report it, is not newer than what is stored.
      api.meResyncRequestedAt = (await syncState.get()).lastMissingFilesCheckAt as string;
      nowMs += 30_000;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(calls + 1);
    });

    it("Resync stores the time the service returned, so the Mac's own nudge does not heal again", async () => {
      await clocked.reconcile();
      nowMs += HOUR;
      const nudge = new Date(nowMs + 5 * MIN).toISOString();
      api.resyncAt = nudge;
      await clocked.resync();
      expect((await syncState.get()).lastMissingFilesCheckAt).toBe(nudge);
      const calls = api.missingCalls;

      api.meResyncRequestedAt = nudge;
      nowMs += 30_000;
      await clocked.reconcile();
      expect(api.missingCalls).toBe(calls);
    });
  });

  describe("paginated pull (#30)", () => {
    function phoneRecord(id: string): SyncRecord {
      return {
        syncVersion: 1,
        id,
        kind: "single",
        title: `Phone Song ${id}`,
        artist: "Phone Artist",
        year: null,
        genre: null,
        cover: null,
        tracks: [],
        origin: "ios",
        originDevice: "Toby's iPhone",
        createdAt: "2026-09-27T10:00:00.000Z",
        updatedAt: "2026-09-27T10:00:00.000Z",
        deleted: false,
      };
    }

    it("pulls a 450-release remote library completely in one reconcile (3 pages)", async () => {
      for (let i = 0; i < 450; i++) {
        api.seedRemoteRecord(phoneRecord(`ios-${i}`));
      }

      await engine.reconcile();

      const status = await engine.status();
      expect(status.lastError).toBeNull();
      expect(status.pendingFromPhone).toHaveLength(450);
      // 200 + 200 + 50 = 3 pages.
      expect(api.listReleasesCallCount).toBe(3);

      const settings = await settingsStore.get();
      expect(settings.sync?.lastVersion).toBe(450);
    });

    it("applies page 1 and stops there when page 2 fails, then resumes on the next reconcile", async () => {
      for (let i = 0; i < 450; i++) {
        api.seedRemoteRecord(phoneRecord(`ios-${i}`));
      }
      api.failListReleasesOnCall(2);

      await engine.reconcile();

      let status = await engine.status();
      expect(status.lastError).toMatch(/injected failure/i);
      expect(status.pendingFromPhone).toHaveLength(200);
      let settings = await settingsStore.get();
      expect(settings.sync?.lastVersion).toBe(200);

      // Next reconcile resumes from where it left off and finishes the pull.
      await engine.reconcile();

      status = await engine.status();
      expect(status.lastError).toBeNull();
      expect(status.pendingFromPhone).toHaveLength(450);
      settings = await settingsStore.get();
      expect(settings.sync?.lastVersion).toBe(450);
    });

    it("treats a response without hasMore as the last page", async () => {
      api.seedRemoteRecord(phoneRecord("ios-only"));

      await engine.reconcile();

      const status = await engine.status();
      expect(status.lastError).toBeNull();
      expect(status.pendingFromPhone).toHaveLength(1);
      expect(api.listReleasesCallCount).toBe(1);
    });

    it("stops the loop and sets lastError on a non-advancing nextVersion with hasMore true", async () => {
      const record = { ...phoneRecord("ios-stalled"), version: 1 };
      api.stallNonAdvancing(record, 0);

      await engine.reconcile();

      const status = await engine.status();
      expect(status.lastError).toMatch(/stalled|advanc/i);
    });
  });

  describe("play counts (#107)", () => {
    const RELEASE_ID = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
    const trackId = (n: number) => `a1b2c3d4-${String(n).padStart(4, "0")}-4a5b-8c9d-0123456789ab`;
    let plays: FakePlayCountStore;
    let playsEngine: SyncEngine;

    beforeEach(() => {
      plays = new FakePlayCountStore();
      playsEngine = new SyncEngine(
        settingsStore,
        syncState,
        releaseService,
        fsSvc,
        () => api,
        () => "Toby's MacBook",
        plays
      );
    });

    it("pushes only entries whose count is above what was pushed, as absolute counts", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0); // never pushed
      plays.seed(trackId(2), RELEASE_ID, 7, 3); // grew since the last push
      plays.seed(trackId(3), RELEASE_ID, 4, 4); // nothing new

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([
        [
          { releaseId: RELEASE_ID, trackId: trackId(1), count: 5 },
          { releaseId: RELEASE_ID, trackId: trackId(2), count: 7 },
        ],
      ]);
    });

    it("a counted play pushes only the changed day, then nothing, then that day again with its new absolute value (#202)", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 5, { "2026-10-14": 2, "2026-10-15": 3 }, { "2026-10-14": 2 });

      await playsEngine.reconcile();
      expect(api.playPushes).toEqual([
        [{ releaseId: RELEASE_ID, trackId: trackId(1), count: 5, days: [{ day: "2026-10-15", count: 3 }] }],
      ]);
      expect((await plays.get()).tracks[trackId(1)].pushedDays).toEqual({ "2026-10-14": 2, "2026-10-15": 3 });

      await playsEngine.reconcile();
      expect(api.playPushes).toHaveLength(1);

      await plays.increment(trackId(1), RELEASE_ID, "2026-10-15");
      await playsEngine.reconcile();
      expect(api.playPushes[1]).toEqual([
        { releaseId: RELEASE_ID, trackId: trackId(1), count: 6, days: [{ day: "2026-10-15", count: 4 }] },
      ]);
    });

    it("a track with day buckets and nothing pushed sends all its days, and a finished pass sets daysInSync", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0, { "2026-10-14": 2, "2026-10-15": 3 });

      await playsEngine.reconcile();

      expect(api.playPushes[0][0].days).toEqual([
        { day: "2026-10-14", count: 2 },
        { day: "2026-10-15", count: 3 },
      ]);
      const counts = await plays.get();
      expect(counts.daysInSync).toBe(true);
      expect(counts.tracks[trackId(1)]).toEqual({
        releaseId: RELEASE_ID,
        count: 5,
        pushed: 5,
        days: { "2026-10-14": 2, "2026-10-15": 3 },
        pushedDays: { "2026-10-14": 2, "2026-10-15": 3 },
      });
    });

    it("keeps to 2,000 day rows and 500 entries per request, and splits a track past 400 days", async () => {
      const dayList = (n: number) => {
        const out: Record<string, number> = {};
        let k = 0;
        for (let y = 2025; k < n; y++) for (let m = 1; m <= 12 && k < n; m++) for (let d = 1; d <= 28 && k < n; d++, k++) out[`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`] = 1;
        return out;
      };
      for (let i = 1; i <= 7; i++) plays.seed(trackId(i), RELEASE_ID, 400, 0, dayList(400)); // 2,800 rows
      plays.seed(trackId(8), RELEASE_ID, 900, 0, dayList(900)); // 400 + 400 + 100

      await playsEngine.reconcile();

      for (const batch of api.playPushes) {
        expect(batch.length).toBeLessThanOrEqual(500);
        expect(batch.reduce((n, e) => n + (e.days?.length ?? 0), 0)).toBeLessThanOrEqual(2000);
        expect(new Set(batch.map((e) => e.trackId)).size).toBe(batch.length);
        for (const e of batch) expect(e.days?.length ?? 0).toBeLessThanOrEqual(400);
      }
      expect(api.playPushes.flat().filter((e) => e.trackId === trackId(8)).map((e) => e.days?.length).sort()).toEqual([100, 400, 400]);
      const entries = Object.values((await plays.get()).tracks);
      expect(entries.every((e) => Object.keys(e.pushedDays ?? {}).length === Object.keys(e.days ?? {}).length)).toBe(true);
    });

    it("sign-out clears the day markers and daysInSync, and the next pass sends every day again", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0, { "2026-10-14": 2, "2026-10-15": 3 });
      await playsEngine.reconcile();
      await plays.resetPushed();
      const cleared = await plays.get();
      expect(cleared.daysInSync).toBeUndefined();
      expect(cleared.tracks[trackId(1)].pushedDays).toBeUndefined();

      await playsEngine.reconcile();

      expect(api.playPushes[1][0].days).toEqual([
        { day: "2026-10-14", count: 2 },
        { day: "2026-10-15", count: 3 },
      ]);
      expect((await plays.get()).daysInSync).toBe(true);
    });

    it("retries a permanently refused batch with days once without them: counts marked, days pending", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0, { "2026-10-15": 5 });
      api.failPlayPushOnCall(1, new SyncRequestError("Invalid body", 400));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([[{ releaseId: RELEASE_ID, trackId: trackId(1), count: 5 }]]);
      const entry = (await plays.get()).tracks[trackId(1)];
      expect(entry.pushed).toBe(5);
      expect(entry.pushedDays).toBeUndefined();
      // Its days never reached the service, so the pass doesn't count as in sync: the summary merge
      // keeps subtracting this Mac's local days instead of trusting the (absent) markers.
      expect((await plays.get()).daysInSync).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect((await playsEngine.status()).lastError).toBeNull();
      warn.mockRestore();
    });

    it("marks nothing for the retry when the days-less retry is refused too", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0, { "2026-10-15": 5 });
      api.failPlayPushOnCall(1, new SyncRequestError("Invalid body", 400));
      api.failPlayPushOnCall(2, new SyncRequestError("Invalid body", 400));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([]);
      expect((await plays.get()).tracks[trackId(1)].pushed).toBe(0);
      warn.mockRestore();
    });

    it("an epoch change mid-push marks no counts, no days, and not daysInSync", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5, 0, { "2026-10-15": 5 });
      api.afterPlayPush = () => plays.resetPushed();

      await playsEngine.reconcile();

      const counts = await plays.get();
      expect(counts.tracks[trackId(1)].pushed).toBe(0);
      expect(counts.tracks[trackId(1)].pushedDays).toBeUndefined();
      expect(counts.daysInSync).toBeUndefined();
    });

    it("records pushed on success, so the next reconcile sends nothing", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5);

      await playsEngine.reconcile();
      expect((await plays.get()).tracks[trackId(1)]).toEqual({ releaseId: RELEASE_ID, count: 5, pushed: 5 });
      await playsEngine.reconcile();

      expect(api.playPushes).toHaveLength(1);
      expect((await playsEngine.status()).lastError).toBeNull();
    });

    it("sends a track again when its count grows after a push", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5);
      await playsEngine.reconcile();
      await plays.increment(trackId(1), RELEASE_ID, "2026-10-15");

      await playsEngine.reconcile();

      expect(api.playPushes).toHaveLength(2);
      expect(api.playPushes[1]).toEqual([
        { releaseId: RELEASE_ID, trackId: trackId(1), count: 6, days: [{ day: "2026-10-15", count: 1 }] },
      ]);
    });

    it("sends at most 500 entries per request and marks each request once it is accepted", async () => {
      for (let i = 1; i <= 1200; i++) plays.seed(trackId(i), RELEASE_ID, 1);

      await playsEngine.reconcile();

      expect(api.playPushes.map((batch) => batch.length)).toEqual([500, 500, 200]);
      const left = Object.values((await plays.get()).tracks).filter((e) => e.count > e.pushed);
      expect(left).toHaveLength(0);
    });

    it("leaves entries pending when a push fails, shows the error, and catches up on the next reconcile", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5);
      api.failPlayPushOnCall(1);

      await playsEngine.reconcile();

      expect((await playsEngine.status()).lastError).toMatch(/injected failure/);
      expect((await plays.get()).tracks[trackId(1)].pushed).toBe(0);
      expect(api.playPushes).toEqual([]);

      await playsEngine.reconcile();

      expect(api.playPushes).toHaveLength(1);
      expect((await plays.get()).tracks[trackId(1)].pushed).toBe(5);
      expect((await playsEngine.status()).lastError).toBeNull();
    });

    it("keeps the batches that were accepted when a later batch fails", async () => {
      for (let i = 1; i <= 600; i++) plays.seed(trackId(i), RELEASE_ID, 2);
      api.failPlayPushOnCall(2);

      await playsEngine.reconcile();

      const entries = Object.values((await plays.get()).tracks);
      expect(entries.filter((e) => e.pushed === 2)).toHaveLength(500);
      expect(entries.filter((e) => e.pushed === 0)).toHaveLength(100);

      await playsEngine.reconcile();

      expect(api.playPushes.map((batch) => batch.length)).toEqual([500, 100]);
      expect(Object.values((await plays.get()).tracks).every((e) => e.pushed === 2)).toBe(true);
    });

    it("leaves out an entry the service would refuse, without holding back the rest", async () => {
      plays.seed("not-a-uuid", RELEASE_ID, 3);
      plays.seed(trackId(1), RELEASE_ID, 2_000_000);
      plays.seed(trackId(2), RELEASE_ID, 4);

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([[{ releaseId: RELEASE_ID, trackId: trackId(2), count: 4 }]]);
      expect((await playsEngine.status()).lastError).toBeNull();
    });

    it("pushes nothing while signed out, and the counts stay pending", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5);
      const settings = await settingsStore.get();
      await settingsStore.set({ ...settings, sync: { ...settings.sync!, deviceToken: null, email: null } });

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([]);
      expect((await plays.get()).tracks[trackId(1)]).toEqual({ releaseId: RELEASE_ID, count: 5, pushed: 0 });
    });

    it("pushes counts after the release records, so the service already holds the release", async () => {
      const release = await importOne();
      plays.seed(release.tracks[0].id, release.id, 1);

      await playsEngine.reconcile();

      expect(api.order).toEqual(["put", "plays"]);
    });

    it("sends everything again after the pushed markers are reset (sign-out, new account)", async () => {
      plays.seed(trackId(1), RELEASE_ID, 5);
      await playsEngine.reconcile();
      await plays.resetPushed();

      await playsEngine.reconcile();

      expect(api.playPushes).toHaveLength(2);
      expect(api.playPushes[1]).toEqual([{ releaseId: RELEASE_ID, trackId: trackId(1), count: 5 }]);
    });

    it("a sign-out while a push is in flight leaves nothing marked and sends no further batches", async () => {
      for (let i = 1; i <= 600; i++) plays.seed(trackId(i), RELEASE_ID, 2);
      api.afterPlayPush = () => plays.resetPushed(); // the user signs out as the first request lands

      await playsEngine.reconcile();

      expect(api.playPushes.map((batch) => batch.length)).toEqual([500]);
      const entries = Object.values((await plays.get()).tracks);
      expect(entries.every((e) => e.pushed === 0)).toBe(true);
      expect(entries.every((e) => e.count === 2)).toBe(true);
    });

    it("skips a batch the service refuses with a 4xx, still sends the later ones, and leaves it pending", async () => {
      for (let i = 1; i <= 600; i++) plays.seed(trackId(i), RELEASE_ID, 2);
      api.failPlayPushOnCall(1, new SyncRequestError("Invalid body", 400));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();

      expect(api.playPushes.map((batch) => batch.length)).toEqual([100]);
      const entries = Object.values((await plays.get()).tracks);
      expect(entries.filter((e) => e.pushed === 0)).toHaveLength(500);
      expect(entries.filter((e) => e.pushed === 2)).toHaveLength(100);
      expect((await playsEngine.status()).lastError).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0].join(" ")).toMatch(/refused a batch of 500 .*HTTP 400/);
      warn.mockRestore();
    });

    it("logs a batch the service keeps refusing once, not on every reconcile, and retries it each time", async () => {
      for (let i = 1; i <= 600; i++) plays.seed(trackId(i), RELEASE_ID, 2);
      api.failPlayPushOnCall(1, new SyncRequestError("Invalid body", 422)); // reconcile 1, batch of 500
      api.failPlayPushOnCall(3, new SyncRequestError("Invalid body", 422)); // reconcile 2, same batch again
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();
      await playsEngine.reconcile();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(Object.values((await plays.get()).tracks).filter((e) => e.pushed === 0)).toHaveLength(500);
      warn.mockRestore();
    });

    it.each([
      ["a 429", new SyncRequestError("Slow down", 429)],
      ["a 503", new SyncRequestError("Down", 503)],
      ["a 401", new SyncAuthError("Sync sign-in has expired; please sign in again")],
    ])("does not skip past %s: the push stops, shows the error, and everything stays pending", async (_n, error) => {
      for (let i = 1; i <= 600; i++) plays.seed(trackId(i), RELEASE_ID, 2);
      api.failPlayPushOnCall(1, error);

      await playsEngine.reconcile();

      expect(api.playPushes).toEqual([]);
      expect((await playsEngine.status()).lastError).toBe(error.message);
      expect(Object.values((await plays.get()).tracks).every((e) => e.pushed === 0)).toBe(true);
    });

    it("logs how many counts the service ignored, with no ids or token", async () => {
      plays.seed(trackId(1), RELEASE_ID, 2);
      plays.seed(trackId(2), RELEASE_ID, 3);
      plays.seed(trackId(3), RELEASE_ID, 4);
      api.ignoredPerPush = 2;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();

      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0].join(" ");
      expect(line).toContain("ignored 2 of 3 play counts");
      expect(line).not.toContain(RELEASE_ID);
      expect(line).not.toContain(trackId(1));
      expect(line).not.toContain("tok");
      warn.mockRestore();
    });

    it("says nothing when the service ignored none", async () => {
      plays.seed(trackId(1), RELEASE_ID, 2);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await playsEngine.reconcile();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("does not touch plays when no store is wired", async () => {
      await engine.reconcile();
      expect(api.playPushes).toEqual([]);
    });
  });
  describe("play events (#398)", () => {
    const RELEASE_ID = "3f2a6c1e-8b7d-4e5a-9c1d-2a4b6c8d0e1f";
    const TRACK_ID = "a1b2c3d4-0001-4a5b-8c9d-0123456789ab";
    let configRoot: string;
    let originalConfig: string | undefined;
    let events: FilePlayEventStore;
    let eventsEngine: SyncEngine;
    let eventCounts: FakePlayCountStore;
    let clockMs = Date.now();
    const START = Date.now() - 3600_000;

    beforeEach(async () => {
      originalConfig = process.env.LOCALLY_CONFIG_DIR;
      configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sli-sync-events-"));
      process.env.LOCALLY_CONFIG_DIR = path.join(configRoot, "config");
      events = new FilePlayEventStore();
      eventCounts = new FakePlayCountStore();
      clockMs = Date.now();
      eventsEngine = new SyncEngine(
        settingsStore, syncState, releaseService, fsSvc, () => api, () => "Toby's MacBook",
        eventCounts, () => new Date(clockMs), undefined, null, events,
      );
    });

    afterEach(async () => {
      if (originalConfig === undefined) delete process.env.LOCALLY_CONFIG_DIR;
      else process.env.LOCALLY_CONFIG_DIR = originalConfig;
      await fs.rm(configRoot, { recursive: true, force: true });
    });

    const add = (n: number, listenedMs = 31_000) =>
      events.record({ releaseId: RELEASE_ID, trackId: TRACK_ID, source: "locally", startedAt: START + n * 1000, listenedMs });

    it("pushes pending events right after the plays push, in the wire shape, and marks them", async () => {
      await add(1);
      await eventsEngine.reconcile();
      expect(api.eventPushes).toHaveLength(1);
      expect(api.eventPushes[0][0]).toEqual({
        id: expect.any(String), releaseId: RELEASE_ID, trackId: TRACK_ID, source: "locally",
        startedAt: START + 1000, day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), listenedMs: 31_000,
      });
      expect((await events.list())[0].pushedListenedMs).toBe(31_000);
      // Nothing new: nothing sent.
      await eventsEngine.reconcile();
      expect(api.eventPushes).toHaveLength(1);
    });

    it("sends an event again when its listenedMs has grown since it was pushed", async () => {
      await add(1);
      await eventsEngine.reconcile();
      await add(1, 120_000);
      await eventsEngine.reconcile();
      expect(api.eventPushes).toHaveLength(2);
      expect(api.eventPushes[1]).toHaveLength(1);
      expect(api.eventPushes[1][0].listenedMs).toBe(120_000);
      expect((await events.list())[0].pushedListenedMs).toBe(120_000);
    });

    it("sends batches of 500", async () => {
      // Written straight to the file: adding 1,203 one at a time would rewrite it 1,203 times.
      const seeded = Array.from({ length: 1203 }, (_, n) => ({
        id: crypto.randomUUID(), releaseId: RELEASE_ID, trackId: TRACK_ID, source: "locally",
        startedAt: START + n * 1000, day: "2026-10-24", listenedMs: 31_000, pushedListenedMs: null,
      }));
      await fs.mkdir(path.dirname(playEventsFilePath()), { recursive: true });
      await fs.writeFile(playEventsFilePath(), JSON.stringify({ version: 1, events: seeded }));
      await eventsEngine.reconcile();
      expect(api.eventPushes.map((b) => b.length)).toEqual([500, 500, 203]);
      expect((await events.list()).every((e) => e.pushedListenedMs === 31_000)).toBe(true);
    });

    it.each([404, 429, 500] as const)("a %i leaves the events pending and adds no error line", async (status) => {
      await add(1);
      api.eventsRoute = status;
      await eventsEngine.reconcile();
      expect((await events.list())[0].pushedListenedMs).toBeNull();
      expect((await eventsEngine.status()).lastError).toBeNull();
      // The service comes back: the next pass sends them.
      api.eventsRoute = "ok";
      clockMs += 11 * 60_000; // past the 404/429 back-off
      await eventsEngine.reconcile();
      expect((await events.list())[0].pushedListenedMs).toBe(31_000);
    });

    const switchAccount = async () => {
      const settings = await settingsStore.get();
      await settingsStore.set({ ...settings, sync: { ...settings.sync!, deviceToken: "tok-2", email: "other@b.com" } });
    };

    it("an account switch between the counts push and the events push sends no events and marks none", async () => {
      await add(1);
      eventCounts.seed(TRACK_ID, RELEASE_ID, 1);
      api.afterPlayPush = switchAccount;
      await eventsEngine.reconcile();
      expect(api.playPushes).toHaveLength(1);
      expect(api.eventAttempts).toBe(0);
      expect((await events.list())[0].pushedListenedMs).toBeNull();
    });

    it("an account switch between two event batches sends no further batch and marks nothing", async () => {
      const seeded = Array.from({ length: 600 }, (_, n) => ({
        id: crypto.randomUUID(), releaseId: RELEASE_ID, trackId: TRACK_ID, source: "locally",
        startedAt: START + n * 1000, day: "2026-10-24", listenedMs: 31_000, pushedListenedMs: null,
      }));
      await fs.mkdir(path.dirname(playEventsFilePath()), { recursive: true });
      await fs.writeFile(playEventsFilePath(), JSON.stringify({ version: 1, events: seeded }));
      api.afterEventPush = switchAccount;
      await eventsEngine.reconcile();
      expect(api.eventPushes.map((b) => b.length)).toEqual([500]);
      expect((await events.list()).every((e) => e.pushedListenedMs === null)).toBe(true);
    });

    it.each([404, 429] as const)("a %i backs the events push off for 10 minutes, then it tries again", async (status) => {
      await add(1);
      api.eventsRoute = status;
      await eventsEngine.reconcile();
      expect(api.eventAttempts).toBe(1);
      api.eventsRoute = "ok";
      clockMs += 9 * 60_000;
      await eventsEngine.reconcile();
      expect(api.eventAttempts).toBe(1);
      clockMs += 61_000;
      await eventsEngine.reconcile();
      expect(api.eventAttempts).toBe(2);
      expect((await events.list())[0].pushedListenedMs).toBe(31_000);
    });

    it("a 500 does not back off", async () => {
      await add(1);
      api.eventsRoute = 500;
      await eventsEngine.reconcile();
      await eventsEngine.reconcile();
      expect(api.eventAttempts).toBe(2);
    });

    it("does not touch events when no store is wired", async () => {
      await add(1);
      await engine.reconcile();
      expect(api.eventPushes).toEqual([]);
    });
  });
});
