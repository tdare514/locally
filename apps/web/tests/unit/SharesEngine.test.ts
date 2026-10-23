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
import { emptySyncState, type SyncState, type SyncStateStore } from "../../src/server/sync/SyncState";
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

const share = (over: Partial<ReceivedShare> = {}): ReceivedShare => ({
  id: "share-1",
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
  let calls: string[];
  let received: ReceivedShare[];
  let me: { publicSharesEnabled?: boolean };
  let failDownload: boolean;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-shares-"));
    calls = [];
    received = [share()];
    me = { publicSharesEnabled: false };
    failDownload = false;
    repo = new Repo();
    const settings = new Settings1({
      libraryDir,
      sync: { baseUrl: "http://fake", deviceToken: "tok", email: "me@example.com", lastVersion: 0 },
    });
    const nodeFs = new NodeFileSystem();
    const releases = new ReleaseService(settings, repo, noConvert, new Id3TagService(), nodeFs, new ReleaseLayout());
    const api = {
      async listReleases() {
        return { releases: [], nextVersion: 0, hasMore: false };
      },
      async listReceivedShares() {
        return { shares: received, nextCursor: null };
      },
      async me() {
        return { user: { id: "u", email: "me@example.com" }, device: { id: "d", name: "n" }, quota: { usedBytes: 0, limitBytes: 1 }, devices: [], ...me };
      },
      async missingFiles() {
        return null;
      },
      async claimShare(id: string) {
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
        if (failDownload) throw new Error("Download failed (500)");
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
    engine = new SyncEngine(settings, new MemState(), releases, nodeFs, () => api, () => "Test Mac");
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("lists received shares in the tray after a reconcile, with the sender's email", async () => {
    await engine.reconcile();
    const friends = (await engine.status()).fromFriends ?? [];
    expect(friends).toEqual([
      expect.objectContaining({ id: "share-1", fromEmail: "sam@example.com", title: "Night Drive", trackCount: 2, hasCover: true }),
    ]);
  });

  it("hides a claimed share from the tray", async () => {
    received = [share({ claimedAt: "2026-10-23T09:00:00.000Z" }), share({ id: "share-2" })];
    await engine.reconcile();
    expect((await engine.status()).fromFriends?.map((f) => f.id)).toEqual(["share-2"]);
  });

  it("claims, then imports a new release tagged exactly as the snapshot", async () => {
    await engine.reconcile();
    const release = await engine.acceptFriendShare("share-1");

    expect(calls.slice(0, 1)).toEqual(["claim share-1"]);
    expect(calls).toContain("file share-1 cover.jpg");
    expect(calls).toContain("hide share-1");
    expect(release.id).not.toBe("share-1");
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

  it("keeps the row in the tray when the import fails after the claim", async () => {
    await engine.reconcile();
    failDownload = true;
    await expect(engine.acceptFriendShare("share-1")).rejects.toThrow(/Download failed/);
    received = [share({ claimedAt: "2026-10-23T11:00:00.000Z" })]; // the service now says claimed
    await engine.reconcile();
    expect((await engine.status()).fromFriends?.map((f) => f.id)).toEqual(["share-1"]);
    expect(repo.items).toHaveLength(0);
  });

  it("refuses a share that names a file outside its folder", async () => {
    received = [share({ snapshot: { ...share().snapshot, tracks: [{ id: "t", title: "x", trackNumber: 1, file: "../evil.mp3", bytes: 1 }] } })];
    await engine.reconcile();
    await expect(engine.acceptFriendShare("share-1")).rejects.toThrow(/won't use/);
    expect(calls).toEqual([]);
  });

  it("dismisses with hide and drops the row", async () => {
    await engine.reconcile();
    await engine.hideFriendShare("share-1");
    expect(calls).toEqual(["hide share-1"]);
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
        item: { id: "share-1", fromEmail: "sam@example.com", title: "Night Drive", artist: "Okoro", kind: "album", trackCount: 2, hasCover: false, createdAt: "x" },
        leaving: false,
        onSend: () => {},
        onDismiss: () => {},
      })
    );
    expect(html).toContain("from sam@example.com");
    expect(html).toContain('aria-label="Send Night Drive to Spotify"');
    expect(html).toContain('aria-label="Dismiss Night Drive"');
  });
});
