import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFile } from "music-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FriendRow } from "../../src/components/PhoneInbox";
import { Id3TagService } from "../../src/server/audio/Id3TagService";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { ReleaseService } from "../../src/server/releases/ReleaseService";
import type { LibraryRepository } from "../../src/server/storage/LibraryRepository";
import type { SyncApi } from "../../src/server/sync/SyncApi";
import { SyncEngine } from "../../src/server/sync/SyncEngine";
import { emptySyncState, resetKeepingImports, type SyncState, type SyncStateStore } from "../../src/server/sync/SyncState";
import type { ReceivedShare } from "../../src/shared/shares";
import type { Release, Settings } from "../../src/shared/types";

function silentMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 10 }, () => frame));
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

class Settings1 implements SettingsStore {
  constructor(private s: Settings) {}
  async get() {
    return this.s;
  }
  async set(s: Settings) {
    this.s = s;
    return s;
  }
  async update(m: (c: Settings) => Settings | null) {
    const n = m(this.s);
    if (n) this.s = n;
    return this.s;
  }
}
class Repo implements LibraryRepository {
  items: Release[] = [];
  async list() {
    return this.items;
  }
  async find(_d: string, id: string) {
    return this.items.find((r) => r.id === id) ?? null;
  }
  async upsert(_d: string, r: Release) {
    this.items = [...this.items.filter((x) => x.id !== r.id), r];
    return r;
  }
  async remove(_d: string, id: string) {
    const r = this.items.find((x) => x.id === id) ?? null;
    this.items = this.items.filter((x) => x.id !== id);
    return r;
  }
}
class MemState implements SyncStateStore {
  state: SyncState = emptySyncState();
  async get() {
    return structuredClone(this.state);
  }
  async set(s: SyncState) {
    this.state = s;
    return s;
  }
  async update(m: (c: SyncState) => SyncState | null) {
    const n = m(await this.get());
    if (n) this.state = n;
    return this.state;
  }
}
const noConvert: AudioConverter = {
  async toMp3() {
    throw new Error("not used");
  },
};

const ACCOUNT_A = "http://fake\nme@example.com";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

const share = (over: Partial<ReceivedShare> = {}): ReceivedShare => ({
  id: S1,
  from: { email: "sam@example.com" },
  trackIds: null,
  allowReshare: false,
  canReshare: false,
  expiresAt: null,
  createdAt: "2026-10-23T10:00:00.000Z",
  claimedAt: null,
  snapshot: {
    kind: "album",
    title: "Night Drive",
    artist: "Okoro",
    year: "2024",
    releaseDate: "2024-05-17",
    genre: "Electronic",
    cover: "cover.jpg",
    coverHash: null,
    tracks: [
      { id: "t1", title: "Intro", trackNumber: 1, discNumber: 1, file: "intro.mp3", bytes: 1 },
      { id: "t2", title: "Song (feat. Bo)", trackNumber: 2, discNumber: 2, file: "song.mp3", bytes: 1 },
    ],
  },
  ...over,
});

describe("shares on the Mac", () => {
  let libraryDir: string;
  let repo: Repo;
  let engine: SyncEngine;
  let state: MemState;
  let calls: string[];
  let received: ReceivedShare[];
  let me: { publicSharesEnabled?: boolean };
  let failDownload: boolean;
  let failClaim: boolean;
  let settingsStore: Settings1;
  let listGate: Promise<void> | null;
  let releasesGate: Promise<void> | null;
  let meGate: Promise<void> | null;
  let cacheDir: string;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-shares-"));
    calls = [];
    received = [share()];
    me = { publicSharesEnabled: false };
    failDownload = false;
    failClaim = false;
    listGate = null;
    releasesGate = null;
    meGate = null;
    cacheDir = path.join(libraryDir, "..", `sli-share-covers-${path.basename(libraryDir)}`);
    repo = new Repo();
    const settings = new Settings1({
      libraryDir,
      sync: { baseUrl: "http://fake", deviceToken: "tok", email: "me@example.com", lastVersion: 0 },
    });
    const nodeFs = new NodeFileSystem();
    const releases = new ReleaseService(settings, repo, noConvert, new Id3TagService(), nodeFs, new ReleaseLayout());
    const api = {
      async listReleases() {
        if (releasesGate) await releasesGate;
        return { releases: [], nextVersion: 0, hasMore: false };
      },
      async listReceivedShares() {
        const snapshot = received;
        if (listGate) await listGate;
        return { shares: snapshot, nextCursor: null };
      },
      async reshareShare(id: string, body: unknown) {
        calls.push(`reshare ${id} ${JSON.stringify(body)}`);
        return { share: null, notOnLocally: [], link: null };
      },
      async createShare() {
        calls.push("create");
        return { share: null, notOnLocally: [], link: null };
      },
      async me() {
        const reply = { ...me };
        if (meGate) await meGate;
        void reply;
        return { user: { id: "u", email: "me@example.com" }, device: { id: "d", name: "n" }, quota: { usedBytes: 0, limitBytes: 1 }, devices: [], ...reply };
      },
      async missingFiles() {
        return null;
      },
      async claimShare(id: string) {
        if (failClaim) throw new Error("claim failed");
        calls.push(`claim ${id}`);
        return { claimedAt: "2026-10-23T11:00:00.000Z" };
      },
      async hideShare(id: string) {
        calls.push(`hide ${id}`);
      },
      async shareFileUrl(id: string, name: string) {
        calls.push(`file ${id} ${name}`);
        return { url: `fake://${name}`, expiresAt: "x" };
      },
      async downloadFile(url: string, dest: string) {
        if (failDownload && !dest.includes(cacheDir)) throw new Error("Download failed (500)");
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const name = url.replace("fake://", "");
        await fs.writeFile(dest, name.endsWith(".jpg") ? JPEG : silentMp3());
      },
      async putRelease() {
        return { version: 1 };
      },
      async createUploads() {
        return { uploads: [] };
      },
      async revokeShare(id: string) {
        calls.push(`revoke ${id}`);
      },
    } as unknown as SyncApi;
    settingsStore = settings;
    state = new MemState();
    engine = new SyncEngine(settings, state, releases, nodeFs, () => api, () => "Test Mac", null, undefined, () => cacheDir);
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("lists received shares in the tray after a reconcile, with the sender's email", async () => {
    await engine.reconcile();
    const friends = (await engine.status()).fromFriends ?? [];
    expect(friends).toEqual([
      expect.objectContaining({ id: S1, fromEmail: "sam@example.com", title: "Night Drive", trackCount: 2, hasCover: true }),
    ]);
  });

  it("hides a claimed share from the tray", async () => {
    received = [share({ claimedAt: "2026-10-23T09:00:00.000Z" }), share({ id: S2 })];
    await engine.reconcile();
    expect((await engine.status()).fromFriends?.map((f) => f.id)).toEqual([S2]);
  });

  it("imports a new release tagged exactly as the snapshot, then claims it", async () => {
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);

    expect(calls.indexOf(`claim ${S1}`)).toBeGreaterThan(calls.indexOf(`file ${S1} song.mp3`));
    expect(calls).toContain(`file ${S1} cover.jpg`);
    expect(calls).toContain(`hide ${S1}`);
    expect(release.id).not.toBe(S1);
    expect(release.releaseDate).toBe("2024-05-17");
    expect(release.tracks.map((t) => t.id)).not.toContain("t1");
    expect(release).toMatchObject({ title: "Night Drive", artist: "Okoro", year: "2024", genre: "Electronic", kind: "album" });
    expect(release.coverPath && release.coverPath.startsWith(libraryDir)).toBe(true);
    for (const t of release.tracks) expect(t.filePath.startsWith(libraryDir)).toBe(true);

    const first = await parseFile(release.tracks[0].filePath);
    const second = await parseFile(release.tracks[1].filePath);
    expect(first.common).toMatchObject({ title: "Intro", artist: "Okoro", album: "Night Drive", year: 2024, genre: ["Electronic"] });
    expect(first.common.picture?.length).toBe(1);
    expect(first.common.disk).toMatchObject({ no: 1, of: 2 });
    expect(second.common.title).toBe("Song (feat. Bo)");
    expect(second.common.disk).toMatchObject({ no: 2, of: 2 });
    expect(second.common.track.no).toBe(1); // the position within disc 2
    expect(String(second.common.date)).toContain("2024-05-17");
    expect(repo.items).toHaveLength(1);

    // It left the tray.
    expect((await engine.status()).fromFriends).toEqual([]);
  });

  it("claims nothing and keeps the row when the download or import fails", async () => {
    await engine.reconcile();
    failDownload = true;
    await expect(engine.acceptFriendShare(S1)).rejects.toThrow(/Download failed/);
    expect(calls.some((c) => c.startsWith("claim"))).toBe(false);
    expect((await engine.status()).fromFriends?.map((f) => f.id)).toEqual([S1]);
    await engine.reconcile();
    expect((await engine.status()).fromFriends?.map((f) => f.id)).toEqual([S1]);
    expect(repo.items).toHaveLength(0);
  });

  it("hides an imported share even when the claim fails, and claims it on the next reconcile", async () => {
    await engine.reconcile();
    failClaim = true;
    const release = await engine.acceptFriendShare(S1);
    expect(release.title).toBe("Night Drive");
    expect(repo.items).toHaveLength(1);
    expect((await engine.status()).fromFriends).toEqual([]);
    expect((await state.get()).importedShares?.[ACCOUNT_A]).toHaveProperty(S1);

    // A restart: a fresh reconcile still lists it unclaimed, and the tray keeps it hidden.
    await engine.reconcile();
    expect((await engine.status()).fromFriends).toEqual([]);
    expect(calls).not.toContain(`claim ${S1}`);

    failClaim = false;
    await engine.reconcile();
    expect(calls).toContain(`claim ${S1}`);
    expect((await state.get()).importedShares?.[ACCOUNT_A]).toEqual({});
    // The cached unclaimed row must not come back once the marker is cleared.
    expect((await engine.status()).fromFriends).toEqual([]);
    expect(repo.items).toHaveLength(1);
  });

  it("downloads a cover once, serves it from the cache, and prunes covers no longer listed", async () => {
    await engine.reconcile();
    await engine.reconcile();
    await engine.reconcile();
    expect(calls.filter((c) => c === `file ${S1} cover.jpg`)).toHaveLength(1);
    const first = await engine.friendCover(S1);
    const again = await engine.friendCover(S1);
    expect(first.contentType).toBe("image/jpeg");
    expect(again.bytes.equals(first.bytes)).toBe(true);
    expect(calls.filter((c) => c === `file ${S1} cover.jpg`)).toHaveLength(1);
    expect(await fs.readdir(cacheDir)).toEqual([`${S1}.jpg`]);

    received = [share({ id: S2 })];
    await engine.reconcile();
    expect((await fs.readdir(cacheDir)).sort()).toEqual([`${S2}.jpg`]);
    received = [];
    await engine.reconcile();
    expect(await fs.readdir(cacheDir)).toEqual([]);
  });

  it("never caches a cover for a share id that is not a UUID", async () => {
    received = [share({ id: "../../x" })];
    await engine.reconcile();
    expect(await fs.readdir(cacheDir)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("imports only the shared track of an album as track 1 of 1, with no disc tag", async () => {
    received = [share({ trackIds: ["t2"], snapshot: { ...share().snapshot, tracks: [share().snapshot.tracks[1]] } })];
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);
    expect(release.tracks).toHaveLength(1);
    expect(release.tracks[0]).toMatchObject({ title: "Song (feat. Bo)", trackNumber: 1 });
    expect(release.tracks[0].discNumber).toBeUndefined();
    expect(release).toMatchObject({ title: "Night Drive", kind: "album" });
    const tags = await parseFile(release.tracks[0].filePath);
    expect(tags.common.album).toBe("Night Drive");
    expect(tags.common.track).toMatchObject({ no: 1, of: 1 });
    expect(tags.common.disk.no).toBeNull();
    expect(calls).not.toContain(`file ${S1} intro.mp3`);
  });

  it("keeps disc numbers when the shared tracks still span several discs, renumbered in order", async () => {
    const t = share().snapshot.tracks;
    received = [share({ trackIds: ["t1", "t2"], snapshot: { ...share().snapshot, tracks: [{ ...t[0], trackNumber: 3 }, { ...t[1], trackNumber: 7 }] } })];
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);
    expect(release.tracks.map((x) => [x.trackNumber, x.discNumber])).toEqual([[1, 1], [2, 2]]);
    expect((await parseFile(release.tracks[1].filePath)).common.disk).toMatchObject({ no: 2, of: 2 });
  });

  it("sets sharedFrom on the imported release from the share's id and canReshare", async () => {
    received = [share({ canReshare: true })];
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);
    expect(release.sharedFrom).toEqual({ shareId: S1, allowReshare: true });
    expect((await repo.find("", release.id))?.sharedFrom).toEqual({ shareId: S1, allowReshare: true });
  });

  it("shares an imported release through the reshare route when it may be shared on", async () => {
    received = [share({ canReshare: true })];
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);
    const body = { releaseId: release.id, recipients: ["a@b.co"], visibility: "private" as const, allowReshare: false, expiresInDays: 7 as const };
    await engine.createShare(body);
    expect(calls.filter((c) => c === "create")).toEqual([]);
    expect(calls.find((c) => c.startsWith("reshare"))).toBe(
      `reshare ${S1} ${JSON.stringify({ recipients: ["a@b.co"], visibility: "private", allowReshare: false, expiresInDays: 7 })}`
    );
  });

  it("refuses to share on a release that was not allowed to go on, and calls nothing", async () => {
    received = [share({ canReshare: false })];
    await engine.reconcile();
    const release = await engine.acceptFriendShare(S1);
    expect(release.sharedFrom?.allowReshare).toBe(false);
    const before = calls.length;
    await expect(
      engine.createShare({ releaseId: release.id, recipients: ["a@b.co"], visibility: "private", allowReshare: false, expiresInDays: null })
    ).rejects.toThrow("They didn't allow sharing this on");
    expect(calls.length).toBe(before);
  });

  it("empties the friends list and the cover cache on sign-out", async () => {
    await engine.reconcile();
    expect((await engine.status()).fromFriends).toHaveLength(1);
    expect(await fs.readdir(cacheDir)).toHaveLength(1);
    await settingsStore.update((c) => ({ ...c, sync: c.sync ? { ...c.sync, deviceToken: null } : null }));
    expect((await engine.status()).fromFriends).toEqual([]);
    expect(await fs.readdir(cacheDir)).toEqual([]);
    await expect(engine.friendCover(S1)).rejects.toThrow();
  });

  it("drops a refresh that finishes after the account changed", async () => {
    let release!: () => void;
    listGate = new Promise<void>((resolve) => (release = resolve));
    const running = engine.reconcile();
    await new Promise((r) => setTimeout(r, 50));
    await settingsStore.update((c) => ({ ...c, sync: c.sync ? { ...c.sync, deviceToken: null } : null }));
    release();
    await running;
    expect((await engine.status()).fromFriends).toEqual([]);
    expect(await fs.readdir(cacheDir).catch(() => [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("drops the old host's shares and /me when the host changes during a pull", async () => {
    let resume!: () => void;
    releasesGate = new Promise<void>((resolve) => (resume = resolve));
    const running = engine.reconcile();
    await new Promise((r) => setTimeout(r, 50));
    await settingsStore.update((c) => ({ ...c, sync: c.sync ? { ...c.sync, baseUrl: "http://other-host", deviceToken: "tok2" } : null }));
    resume();
    await running;
    const status = await engine.status();
    expect(status.fromFriends).toEqual([]);
    expect(status.quota).toBeNull();
    expect(await fs.readdir(cacheDir).catch(() => [])).toEqual([]);
  });

  it("keeps friends and cached covers across a settings change that is not a sign-out", async () => {
    await engine.reconcile();
    await settingsStore.update((c) => ({ ...c, libraryDir: c.libraryDir, trackPlays: true }));
    expect((await engine.status()).fromFriends).toHaveLength(1);
    expect(await fs.readdir(cacheDir)).toHaveLength(1);
    await expect(engine.friendCover(S1)).resolves.toBeTruthy();
  });

  it("does not let a /me reply from the old session overwrite the new session's flag", async () => {
    me = { publicSharesEnabled: true };
    let resume!: () => void;
    meGate = new Promise<void>((resolve) => (resume = resolve));
    const asking = engine.shareOptions();
    await new Promise((r) => setTimeout(r, 50));
    await settingsStore.update((c) => ({ ...c, sync: c.sync ? { ...c.sync, baseUrl: "http://other-host", deviceToken: "tok2" } : null }));
    resume();
    const reply = await asking;
    expect(reply.publicSharesEnabled).toBe(false);
    meGate = null;
    me = { publicSharesEnabled: false };
    expect((await engine.shareOptions()).publicSharesEnabled).toBe(false);
  });

  it("keeps an owed claim across sign-out and another account, and does not offer the share again", async () => {
    await engine.reconcile();
    failClaim = true;
    await engine.acceptFriendShare(S1);
    expect(repo.items).toHaveLength(1);

    // Sign out (the route resets the state but keeps the imports), then sign in as B.
    await settingsStore.update((c) => ({ ...c, sync: c.sync ? { ...c.sync, deviceToken: null, email: null } : null }));
    await state.update(resetKeepingImports);
    received = [];
    await settingsStore.update((c) => ({ ...c, sync: { baseUrl: "http://fake", deviceToken: "tokB", email: "b@example.com", lastVersion: 0 } }));
    await engine.reconcile();
    expect((await engine.status()).fromFriends).toEqual([]);
    expect((await state.get()).importedShares?.[ACCOUNT_A]).toHaveProperty(S1);

    // Back to A: the service still lists it unclaimed. It stays hidden and the claim is retried.
    await settingsStore.update((c) => ({ ...c, sync: { baseUrl: "http://fake", deviceToken: "tokA", email: "me@example.com", lastVersion: 0 } }));
    received = [share()];
    expect((await engine.status()).fromFriends).toEqual([]);
    failClaim = false;
    await engine.reconcile();
    expect(calls).toContain(`claim ${S1}`);
    expect((await engine.status()).fromFriends).toEqual([]);
    expect(repo.items).toHaveLength(1);
    expect((await state.get()).importedShares?.[ACCOUNT_A]).toEqual({});
  });

  it("refuses a share that names a file outside its folder", async () => {
    received = [share({ snapshot: { ...share().snapshot, tracks: [{ id: "t", title: "x", trackNumber: 1, file: "../evil.mp3", bytes: 1 }] } })];
    await engine.reconcile();
    await expect(engine.acceptFriendShare(S1)).rejects.toThrow(/won't use/);
    expect(calls.some((c) => c.startsWith("claim"))).toBe(false);
  });

  it("dismisses with hide and drops the row", async () => {
    await engine.reconcile();
    await engine.hideFriendShare(S1);
    expect(calls.filter((c) => c.startsWith("hide"))).toEqual([`hide ${S1}`]);
    expect((await engine.status()).fromFriends).toEqual([]);
  });

  it("reports public links only when /v1/me says so", async () => {
    expect(await engine.shareOptions()).toEqual({ signedIn: true, publicSharesEnabled: false });
    me = { publicSharesEnabled: true };
    expect(await engine.shareOptions()).toEqual({ signedIn: true, publicSharesEnabled: true });
  });

  it("revokes through the service", async () => {
    await engine.revokeShare("sent-1");
    expect(calls).toEqual(["revoke sent-1"]);
  });

  it("renders a row with the title, artist, track count and 'from' line", () => {
    const html = renderToStaticMarkup(
      createElement(FriendRow, {
        item: { id: S1, fromEmail: "sam@example.com", title: "Night Drive", artist: "Okoro", kind: "album", trackCount: 2, hasCover: false, createdAt: "x" },
        leaving: false,
        onSend: () => {},
        onDismiss: () => {},
      })
    );
    expect(html).toContain("from sam@example.com");
    expect(html).toContain('aria-label="Send Night Drive from sam@example.com to Spotify"');
    expect(html).toContain('aria-label="Dismiss Night Drive from sam@example.com"');
    expect(html).toContain('title="sam@example.com"');
  });
});
