import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { ValidationError } from "../../src/shared/errors";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { LibraryRepository } from "../../src/server/storage/LibraryRepository";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
import type { ReadTagsResult, TagService, WriteTagsInput } from "../../src/server/audio/TagService";
import type { Release, Settings } from "../../src/shared/types";
import type { SyncRecord } from "../../src/server/sync/SyncRecord";

/** In-memory `SettingsStore` fake so tests never touch `~/.spotify-local-import`. */
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
    return {
      title: null,
      artist: null,
      album: null,
      year: null,
      genre: null,
      durationSec: 123,
      hasCover: false,
    };
  }
}

function audioFile(name: string, content = "fake audio bytes"): File {
  return new File([content], name, { type: "audio/mpeg" });
}

describe("ReleaseService", () => {
  let libraryDir: string;
  let settings: FakeSettingsStore;
  let repo: InMemoryLibraryRepository;
  let converter: CopyingConverter;
  let tags: RecordingTagService;
  let service: ReleaseService;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-release-service-"));
    settings = new FakeSettingsStore({ libraryDir, sync: null });
    repo = new InMemoryLibraryRepository();
    converter = new CopyingConverter();
    tags = new RecordingTagService();
    service = new ReleaseService(settings, repo, converter, tags, new NodeFileSystem(), new ReleaseLayout());
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("imports a single, falling back the album title to the track title", async () => {
    const release = await service.import(
      { kind: "single", artist: "Solo Artist", tracks: [{ title: "My Track", trackNumber: 1 }] } as never,
      null,
      [audioFile("in.mp3")]
    );

    expect(release.title).toBe("My Track");
    expect(release.tracks).toHaveLength(1);
    expect(release.tracks[0].title).toBe("My Track");
    const exists = await fs
      .access(release.tracks[0].filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    expect(tags.writes).toHaveLength(1);
  });

  it("gives two albums with the same artist/album distinct folders", async () => {
    const meta = {
      kind: "album" as const,
      artist: "Same Artist",
      title: "Same",
      tracks: [{ title: "T1", trackNumber: 1 }],
    };
    const first = await service.import(meta, null, [audioFile("a.mp3")]);
    const second = await service.import(meta, null, [audioFile("b.mp3")]);

    expect(path.basename(first.folderPath)).toBe("Same");
    expect(path.basename(second.folderPath)).toBe("Same (2)");
    expect(first.folderPath).not.toBe(second.folderPath);
  });

  it("swapping two track numbers on update keeps file names and rewrites the track tags", async () => {
    const release = await service.import(
      {
        kind: "album",
        artist: "Artist",
        title: "Album",
        tracks: [
          { title: "First", trackNumber: 1 },
          { title: "Second", trackNumber: 2 },
        ],
      } as never,
      null,
      [audioFile("a.mp3"), audioFile("b.mp3")]
    );

    const [t1, t2] = release.tracks;
    const updated = await service.update(release.id, {
      tracks: [
        { id: t1.id, trackNumber: t2.trackNumber },
        { id: t2.id, trackNumber: t1.trackNumber },
      ],
    });

    const byId = new Map(updated.tracks.map((t) => [t.id, t]));
    expect(byId.get(t1.id)?.trackNumber).toBe(2);
    expect(byId.get(t2.id)?.trackNumber).toBe(1);
    // Names never change on edit: Spotify playlists reference local tracks by path.
    expect(byId.get(t1.id)!.filePath).toBe(t1.filePath);
    expect(byId.get(t2.id)!.filePath).toBe(t2.filePath);
    const lastWrites = tags.writes.slice(-2);
    const writeFor = (p: string) => lastWrites.find((w) => w.filePath === p)?.input;
    expect(writeFor(t1.filePath)?.trackNumber).toBe(2);
    expect(writeFor(t2.filePath)?.trackNumber).toBe(1);

    for (const t of updated.tracks) {
      const exists = await fs
        .access(t.filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    }
  });

  it("delete removes only that release's folder", async () => {
    const releaseA = await service.import(
      { kind: "single", artist: "A", title: "One", tracks: [{ title: "One", trackNumber: 1 }] } as never,
      null,
      [audioFile("a.mp3")]
    );
    const releaseB = await service.import(
      { kind: "single", artist: "B", title: "Two", tracks: [{ title: "Two", trackNumber: 1 }] } as never,
      null,
      [audioFile("b.mp3")]
    );

    await service.delete(releaseA.id);

    const aExists = await fs
      .access(releaseA.folderPath)
      .then(() => true)
      .catch(() => false);
    const bExists = await fs
      .access(releaseB.folderPath)
      .then(() => true)
      .catch(() => false);
    expect(aExists).toBe(false);
    expect(bExists).toBe(true);
    expect(await repo.find(libraryDir, releaseA.id)).toBeNull();
  });

  it("refuses to delete when folderPath is outside the library dir", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-outside-"));
    try {
      const now = new Date().toISOString();
      const rogue: Release = {
        id: "rogue-id",
        kind: "single",
        title: "Rogue",
        artist: "Rogue",
        year: null,
        genre: null,
        coverPath: null,
        folderPath: outsideDir,
        tracks: [],
        createdAt: now,
        updatedAt: now,
      };
      await repo.upsert(libraryDir, rogue);

      await expect(service.delete("rogue-id")).rejects.toBeInstanceOf(ValidationError);

      const stillExists = await fs
        .access(outsideDir)
        .then(() => true)
        .catch(() => false);
      expect(stillExists).toBe(true);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});

import { describe as describe2, it as it2, expect as expect2 } from "vitest";
import { ReleaseService as RS } from "../../src/server/releases/ReleaseService";
import { NodeFileSystem as NFS } from "../../src/server/fs/NodeFileSystem";
import os2 from "node:os";
import fs2 from "node:fs/promises";
import path2 from "node:path";
import type { LibraryRepository as LR } from "../../src/server/storage/LibraryRepository";
import type { Release as R } from "../../src/shared/types";

describe2("ReleaseService import rollback", () => {
  it2("removes the release folder when conversion fails", async () => {
    const libraryDir = await fs2.mkdtemp(path2.join(os2.tmpdir(), "sli-rollback-"));
    const store: R[] = [];
    const repo: LR = {
      list: async () => store,
      find: async (_d, id) => store.find((r) => r.id === id) ?? null,
      upsert: async (_d, r) => { store.push(r); return r; },
      remove: async (_d, id) => { const i = store.findIndex((r) => r.id === id); return i >= 0 ? store.splice(i, 1)[0] : null; },
    };
    const svc = new RS(
      { get: async () => ({ libraryDir, sync: null }), set: async (s) => s },
      repo,
      { toMp3: async () => { throw new Error("boom"); } },
      { write: async () => undefined, read: async () => ({ title: null, artist: null, album: null, year: null, genre: null, durationSec: null, hasCover: false }) },
      new NFS()
    );
    const audio = new File([new Uint8Array([1, 2, 3])], "x.wav");
    await expect2(
      svc.import({ kind: "single", title: "", artist: "A", tracks: [{ title: "T", trackNumber: 1 }] }, null, [audio])
    ).rejects.toThrow("boom");
    const entries = await fs2.readdir(libraryDir);
    expect2(entries).toEqual([]);
    expect2(store).toHaveLength(0);
    await fs2.rm(libraryDir, { recursive: true, force: true });
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe("ReleaseService never writes outside the library", () => {
  let libraryDir: string;
  let repo: InMemoryLibraryRepository;
  let tags: RecordingTagService;

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false
    );

  function build(layout = new ReleaseLayout()): ReleaseService {
    return new ReleaseService(
      new FakeSettingsStore({ libraryDir, sync: null }),
      repo,
      new CopyingConverter(),
      tags,
      new NodeFileSystem(),
      layout
    );
  }

  function rogueRelease(folderPath: string, trackFilePath: string): Release {
    const now = new Date().toISOString();
    return {
      id: "rogue",
      kind: "single",
      title: "One",
      artist: "A",
      year: null,
      genre: null,
      coverPath: null,
      folderPath,
      tracks: [{ id: "t1", title: "T", trackNumber: 1, filePath: trackFilePath, originalName: "v.mp3", durationSec: null }],
      createdAt: now,
      updatedAt: now,
    };
  }

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-inside-"));
    repo = new InMemoryLibraryRepository();
    tags = new RecordingTagService();
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("rejects a track number that would escape the release folder and rolls back", async () => {
    await expect(
      build().import(
        { kind: "single", artist: "A", title: "One", tracks: [{ title: "T", trackNumber: "../../../escaped" }] } as never,
        null,
        [audioFile("a.mp3")]
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await fs.readdir(libraryDir)).toEqual([]);
    expect(tags.writes).toHaveLength(0);
    expect(await repo.list(libraryDir)).toEqual([]);
  });

  it("refuses even if the layout handed back an escaping file name", async () => {
    // The hostile name points at a sibling of the temp library dir; unique per run so a
    // stale file from an earlier failure can't mask a regression.
    const escapedName = `escaped-${path.basename(libraryDir)}.mp3`;
    const escapedPath = path.join(path.dirname(libraryDir), escapedName);
    class HostileLayout extends ReleaseLayout {
      override trackFileName(): string {
        return path.join("..", "..", "..", escapedName);
      }
    }
    await expect(
      build(new HostileLayout()).import(
        { kind: "single", artist: "A", title: "One", tracks: [{ title: "T", trackNumber: 1 }] },
        null,
        [audioFile("a.mp3")]
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await exists(escapedPath)).toBe(false);
    expect(await fs.readdir(libraryDir)).toEqual([]);
    expect(tags.writes).toHaveLength(0);
  });

  it("refuses to rewrite tags on a track the index points outside the library", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sli-outside-"));
    try {
      await repo.upsert(libraryDir, rogueRelease(path.join(libraryDir, "A", "One"), path.join(outside, "victim.mp3")));
      await expect(build().update("rogue", { title: "Renamed" })).rejects.toBeInstanceOf(ValidationError);
      expect(tags.writes).toHaveLength(0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to write a cover into a folder the index points outside the library", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "sli-outside-"));
    try {
      await repo.upsert(libraryDir, rogueRelease(outside, path.join(outside, "victim.mp3")));
      const cover = new File([JPEG], "cover.jpg", { type: "image/jpeg" });
      await expect(build().replaceCover("rogue", cover)).rejects.toBeInstanceOf(ValidationError);
      expect(await fs.readdir(outside)).toEqual([]);
      expect(tags.writes).toHaveLength(0);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("still imports a normal album, with '..' names sanitised to plain children", async () => {
    const release = await build().import(
      {
        kind: "album",
        artist: "A",
        title: "..foo",
        tracks: [
          { title: "..bar", trackNumber: 1 },
          { title: "Two", trackNumber: 2 },
        ],
      },
      null,
      [audioFile("a.mp3"), audioFile("b.mp3")]
    );
    expect(path.basename(release.folderPath)).toBe("foo");
    expect(release.tracks.map((t) => path.basename(t.filePath))).toEqual(["01 - bar.mp3", "02 - Two.mp3"]);
    const nfs = new NodeFileSystem();
    for (const t of release.tracks) {
      expect(nfs.isInside(libraryDir, t.filePath)).toBe(true);
      expect(await exists(t.filePath)).toBe(true);
    }
    expect(tags.writes).toHaveLength(2);
  });
});

describe("ReleaseService.importSynced never reads outside the download dir", () => {
  let sandbox: string;
  let libraryDir: string;
  let dl: string;
  let repo: InMemoryLibraryRepository;
  let tags: RecordingTagService;

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false
    );

  function build(): ReleaseService {
    return new ReleaseService(
      new FakeSettingsStore({ libraryDir, sync: null }),
      repo,
      new CopyingConverter(),
      tags,
      new NodeFileSystem()
    );
  }

  /** A record exactly as `parseSyncRecord` would accept it off the wire. */
  function syncRecord(overrides: Partial<SyncRecord> = {}): SyncRecord {
    const now = "2026-09-27T10:00:00.000Z";
    return {
      syncVersion: 1,
      id: "r1",
      kind: "album",
      title: "T",
      artist: "A",
      year: null,
      genre: null,
      cover: null,
      tracks: [],
      origin: "ios",
      originDevice: "phone",
      createdAt: now,
      updatedAt: now,
      deleted: false,
      ...overrides,
    };
  }

  const track = (id: string, n: number, file: string): SyncRecord["tracks"][number] => ({
    id,
    title: `T${n}`,
    trackNumber: n,
    file,
    bytes: 8,
    durationSec: null,
  });

  beforeEach(async () => {
    // One temp sandbox holds the library, the download dir the sync engine would hand
    // over, and - as its siblings - the files a traversal would reach.
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "sli-synced-"));
    libraryDir = path.join(sandbox, "lib");
    dl = path.join(sandbox, "dl");
    await fs.mkdir(libraryDir);
    await fs.mkdir(dl);
    repo = new InMemoryLibraryRepository();
    tags = new RecordingTagService();
  });

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it("rejects '../' track and cover names before anything is created, leaving their targets untouched", async () => {
    const victims = ["victim.txt", "victim.mp3", "victim.jpg"];
    for (const v of victims) {
      await fs.writeFile(path.join(sandbox, v), `original ${v}`);
    }
    const hostile = syncRecord({
      cover: "../victim.jpg",
      tracks: [track("t1", 1, "../victim.txt"), track("t2", 2, "../victim.mp3")],
    });

    await expect(build().importSynced(hostile, dl)).rejects.toBeInstanceOf(ValidationError);

    for (const v of victims) {
      expect(await fs.readFile(path.join(sandbox, v), "utf8")).toBe(`original ${v}`);
    }
    expect(await fs.readdir(libraryDir)).toEqual([]);
    expect(await fs.readdir(dl)).toEqual([]);
    expect(tags.writes).toHaveLength(0);
    expect(await repo.list(libraryDir)).toEqual([]);
  });

  it.each(["/etc/hosts", "sub/track.mp3", "..", ".hidden.mp3"])(
    "rejects a track file name that is not a plain child: %s",
    async (file) => {
      await expect(build().importSynced(syncRecord({ tracks: [track("t1", 1, file)] }), dl)).rejects.toBeInstanceOf(
        ValidationError
      );
      expect(await fs.readdir(libraryDir)).toEqual([]);
    }
  );

  it("rejects a cover name that is not a plain child even when every track is fine", async () => {
    await fs.writeFile(path.join(dl, "01 - One.mp3"), "mp3 bytes");
    await expect(
      build().importSynced(syncRecord({ cover: "../../cover.jpg", tracks: [track("t1", 1, "01 - One.mp3")] }), dl)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await fs.readdir(libraryDir)).toEqual([]);
    expect(await exists(path.join(dl, "01 - One.mp3"))).toBe(true);
  });

  it("names the conversion scratch file by position, so a track id with separators cannot reach outside", async () => {
    await fs.writeFile(path.join(dl, "song.m4a"), "m4a bytes");
    const victim = path.join(sandbox, "esc.mp3");
    await fs.writeFile(victim, "original");

    const release = await build().importSynced(syncRecord({ tracks: [track("x/../../esc", 1, "song.m4a")] }), dl);

    expect(release.tracks[0].id).toBe("x/../../esc");
    expect(await fs.readFile(victim, "utf8")).toBe("original");
    expect(await fs.readFile(release.tracks[0].filePath, "utf8")).toBe("m4a bytes");
  });

  it("still imports a well-formed record: mp3 moved as-is, m4a converted, cover moved, id kept", async () => {
    await fs.writeFile(path.join(dl, "01 - One.mp3"), "mp3 bytes");
    await fs.writeFile(path.join(dl, "02 - Two.m4a"), "m4a bytes");
    await fs.writeFile(path.join(dl, "cover.jpg"), "jpg bytes");

    const release = await build().importSynced(
      syncRecord({
        id: "ios-release-1",
        cover: "cover.jpg",
        tracks: [track("t2", 2, "02 - Two.m4a"), track("t1", 1, "01 - One.mp3")],
      }),
      dl
    );

    expect(release.id).toBe("ios-release-1");
    expect(release.tracks.map((t) => path.basename(t.filePath))).toEqual(["01 - T1.mp3", "02 - T2.mp3"]);
    expect(await fs.readFile(release.tracks[0].filePath, "utf8")).toBe("mp3 bytes");
    expect(await fs.readFile(release.tracks[1].filePath, "utf8")).toBe("m4a bytes");
    const coverPath = path.join(release.folderPath, "cover.jpg");
    expect(release.coverPath).toBe(coverPath);
    expect(await fs.readFile(coverPath, "utf8")).toBe("jpg bytes");

    const nfs = new NodeFileSystem();
    for (const p of [release.folderPath, coverPath, ...release.tracks.map((t) => t.filePath)]) {
      expect(nfs.isInside(libraryDir, p)).toBe(true);
    }
    // The mp3 and the cover were moved, not copied, out of the download dir.
    expect(await exists(path.join(dl, "01 - One.mp3"))).toBe(false);
    expect(await exists(path.join(dl, "cover.jpg"))).toBe(false);
    expect(tags.writes).toHaveLength(2);
    expect((await repo.list(libraryDir)).map((r) => r.id)).toEqual(["ios-release-1"]);
  });
});

describe("ReleaseService.applyRemote", () => {
  let libraryDir: string;
  let settings: FakeSettingsStore;
  let repo: InMemoryLibraryRepository;
  let tags: RecordingTagService;
  let service: ReleaseService;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-apply-remote-"));
    settings = new FakeSettingsStore({ libraryDir, sync: null });
    repo = new InMemoryLibraryRepository();
    tags = new RecordingTagService();
    service = new ReleaseService(settings, repo, new CopyingConverter(), tags, new NodeFileSystem(), new ReleaseLayout());
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  /** A record matching an already-imported release, so `applyRemote`'s track matching succeeds. */
  function recordFor(release: Release, overrides: Partial<SyncRecord> = {}): SyncRecord {
    return {
      syncVersion: 2,
      id: release.id,
      kind: release.kind,
      title: release.title,
      artist: release.artist,
      year: release.year,
      genre: release.genre,
      cover: release.coverPath ? path.basename(release.coverPath) : null,
      coverHash: null,
      tracks: release.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        trackNumber: t.trackNumber,
        file: path.basename(t.filePath),
        bytes: 8,
        durationSec: t.durationSec,
      })),
      origin: "ios",
      originDevice: "phone",
      createdAt: release.createdAt,
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
      deleted: false,
      ...overrides,
    };
  }

  it("with newCoverPath, writes the new cover to every track and updates coverPath", async () => {
    const release = await service.import(
      {
        kind: "album",
        artist: "A",
        title: "T",
        tracks: [
          { title: "One", trackNumber: 1 },
          { title: "Two", trackNumber: 2 },
        ],
      } as never,
      new File([JPEG], "cover.jpg", { type: "image/jpeg" }),
      [audioFile("a.mp3"), audioFile("b.mp3")]
    );
    tags.writes = []; // only care about applyRemote's own writes

    const dl = await fs.mkdtemp(path.join(os.tmpdir(), "sli-apply-remote-dl-"));
    const newCoverBytes = new Uint8Array([...JPEG, 0xaa]);
    const newCoverPath = path.join(dl, "cover.jpg");
    await fs.writeFile(newCoverPath, newCoverBytes);

    try {
      const record = recordFor(release);
      const updated = await service.applyRemote(record, { newCoverPath });

      expect(updated.coverPath).toBe(release.coverPath);
      expect(await fs.readFile(updated.coverPath!)).toEqual(Buffer.from(newCoverBytes));
      expect(tags.writes).toHaveLength(2);
      for (const w of tags.writes) {
        expect(w.input.coverPath).toBe(updated.coverPath);
      }
    } finally {
      await fs.rm(dl, { recursive: true, force: true });
    }
  });

  it("without newCoverPath, leaves the cover untouched", async () => {
    const release = await service.import(
      { kind: "single", artist: "A", title: "T", tracks: [{ title: "One", trackNumber: 1 }] } as never,
      new File([JPEG], "cover.jpg", { type: "image/jpeg" }),
      [audioFile("a.mp3")]
    );
    const originalBytes = await fs.readFile(release.coverPath!);
    tags.writes = [];

    const record = recordFor(release, { title: "New Title" });
    const updated = await service.applyRemote(record);

    expect(updated.coverPath).toBe(release.coverPath);
    expect(updated.title).toBe("New Title");
    expect(await fs.readFile(release.coverPath!)).toEqual(originalBytes);
    expect(tags.writes[0]?.input.coverPath).toBe(release.coverPath);
  });
});
