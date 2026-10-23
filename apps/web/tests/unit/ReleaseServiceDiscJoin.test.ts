import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFile } from "music-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Id3TagService } from "../../src/server/audio/Id3TagService";
import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { buildPatch } from "../../src/components/ReleaseView";
import { parseUpdateMeta } from "../../src/server/http/validation";
import type { SettingsStore } from "../../src/server/config/SettingsStore";
import type { LibraryRepository } from "../../src/server/storage/LibraryRepository";
import type { AudioConverter } from "../../src/server/audio/AudioConverter";
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

/** Ten silent MPEG-1 Layer III frames, enough for music-metadata to parse. */
function silentMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 10 }, () => frame));
}

async function tagsOf(release: Release) {
  const out: { track: string; disc: string | undefined }[] = [];
  for (const t of release.tracks) {
    const meta = await parseFile(t.filePath);
    const native = Object.values(meta.native).flat();
    out.push({
      track: String(native.find((f) => f.id === "TRCK")?.value),
      disc: native.find((f) => f.id === "TPOS")?.value as string | undefined,
    });
  }
  return out;
}

describe("joining the discs back into one (#222)", () => {
  let libraryDir: string;
  let service: ReleaseService;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-disc-join-"));
    service = new ReleaseService(
      new FakeSettingsStore({ libraryDir, sync: null }),
      new InMemoryLibraryRepository(),
      new CopyingConverter(),
      new Id3TagService(),
      new NodeFileSystem(),
      new ReleaseLayout(),
    );
  });
  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("saves [1,1,2,2], joins to one disc, saves, reopens: no TPOS, whole-release TRCK, no stored disc", async () => {
    const files = [1, 2, 3, 4].map((i) => new File([new Uint8Array(silentMp3())], `${i}.mp3`, { type: "audio/mpeg" }));
    const imported = await service.import(
      {
        kind: "album",
        artist: "Artist",
        title: "Album",
        tracks: [1, 1, 2, 2].map((d, i) => ({ title: `T${i + 1}`, trackNumber: i + 1, discNumber: d })),
      } as never,
      null,
      files,
    );
    expect((await tagsOf(imported)).map((t) => [t.track, t.disc])).toEqual([
      ["1/2", "1/2"], ["2/2", "1/2"], ["1/2", "2/2"], ["2/2", "2/2"],
    ]);

    // The Mac's save path: the draft with the discs cleared makes the patch, the patch is validated and applied.
    const draftTracks = imported.tracks.map((t) => ({ key: t.id, title: t.title }));
    const patch = buildPatch(imported, { title: "Album", artist: "Artist", releaseDate: "", genre: "", tracks: draftTracks });
    expect(patch?.tracks?.map((t) => t.discNumber)).toEqual([null, null, null, null]);
    const parsed = parseUpdateMeta(JSON.parse(JSON.stringify(patch)));
    const updated = await service.update(imported.id, parsed);

    const reopened = (await service.get(updated.id)) as Release;
    for (const t of reopened.tracks) expect(t).not.toHaveProperty("discNumber");
    expect((await tagsOf(reopened)).map((t) => [t.track, t.disc])).toEqual([
      ["1/4", undefined], ["2/4", undefined], ["3/4", undefined], ["4/4", undefined],
    ]);
  });
});
