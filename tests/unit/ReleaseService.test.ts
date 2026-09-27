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
    settings = new FakeSettingsStore({ libraryDir });
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

  it("swapping two track numbers on update renames files without collision", async () => {
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
    expect(path.basename(byId.get(t1.id)!.filePath)).toBe("02 - First.mp3");
    expect(path.basename(byId.get(t2.id)!.filePath)).toBe("01 - Second.mp3");

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
      upsert: async (_d, r) => { store.push(r); },
      remove: async (_d, id) => { const i = store.findIndex((r) => r.id === id); return i >= 0 ? store.splice(i, 1)[0] : null; },
    };
    const svc = new RS(
      { get: async () => ({ libraryDir }), set: async (s) => s },
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
