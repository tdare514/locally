import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { LibraryRepository } from "../../src/server/storage/LibraryRepository";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
import type { ReadTagsResult, TagService, WriteTagsInput } from "../../src/server/audio/TagService";
import type { Release, Settings } from "../../src/shared/types";
import { SyncEngine } from "../../src/server/sync/SyncEngine";
import { emptySyncState, type SyncState, type SyncStateStore } from "../../src/server/sync/SyncState";
import {
  SyncConflictError,
  type MeResult,
  type SyncApi,
  type SyncFileToUpload,
  type SyncUploadTarget,
  type VerifyCodeResult,
} from "../../src/server/sync/SyncApi";
import { toSyncRecord, type SyncRecord } from "../../src/server/sync/SyncRecord";

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
    };
  }
  async set(state: SyncState): Promise<SyncState> {
    this.state = state;
    return state;
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

  private conflictOnce = new Set<string>();
  private serverRecords = new Map<string, SyncRecord & { version: number }>();
  private version = 0;
  private blobs = new Map<string, Buffer>();

  async requestCode(): Promise<void> {}

  async verifyCode(): Promise<VerifyCodeResult> {
    return { token: "tok", user: { id: "u1", email: "a@b.com" }, device: { id: "d1", name: "dev" } };
  }

  async me(): Promise<MeResult> {
    this.meCallCount++;
    return {
      user: { id: "u1", email: "a@b.com" },
      device: { id: "d1", name: "dev" },
      quota: { usedBytes: 100, limitBytes: 1_000_000_000 },
      devices: [],
    };
  }

  async revokeDevice(): Promise<void> {}

  async listReleases(sinceVersion: number) {
    this.listReleasesCallCount++;
    const releases = [...this.serverRecords.values()].filter((r) => r.version > sinceVersion);
    return { releases, nextVersion: this.version };
  }

  async putRelease(record: SyncRecord): Promise<{ version: number }> {
    this.putAttempts++;
    if (this.conflictOnce.has(record.id)) {
      this.conflictOnce.delete(record.id);
      throw new SyncConflictError("conflict");
    }
    this.putCalls.push(record);
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
      { id: "ios-release-1", title: "Phone Song", artist: "Phone Artist", kind: "single", trackCount: 1 },
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
});
