import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import NodeID3 from "node-id3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Id3TagService } from "../../src/server/audio/Id3TagService";
import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { ReleaseLayout } from "../../src/server/releases/ReleaseLayout";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { buildPatch, editableTrack } from "../../src/components/ReleaseView";
import { parseUpdateMeta } from "../../src/server/http/validation";
import { applyTrackEdits } from "../../src/lib/track-order";
import {
  addFeatured,
  commitDraft,
  featuredKeyAction,
  featuringText,
  fromEditor,
  fromInspected,
  removeLastFeatured,
  titleForSave,
  toEditor,
} from "../../src/lib/featuring-field";
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


describe("the pill field's state", () => {
  it("adds a trimmed name and skips an empty one or a duplicate by key", () => {
    expect(addFeatured([], "  B  ")).toEqual(["B"]);
    expect(addFeatured(["B"], "   ")).toEqual(["B"]);
    expect(addFeatured(["Beyoncé"], "beyonce")).toEqual(["Beyoncé"]);
    expect(addFeatured(["B"], "C & D")).toEqual(["B", "C & D"]);
  });

  it("maps Enter and comma to add, and Backspace in an empty input to remove the last", () => {
    expect(featuredKeyAction("Enter", "B", false)).toBe("add");
    expect(featuredKeyAction(",", "B", false)).toBe("add");
    expect(featuredKeyAction("Backspace", "", true)).toBe("removeLast");
    expect(featuredKeyAction("Backspace", "x", true)).toBe("none");
    expect(featuredKeyAction("Backspace", "", false)).toBe("none");
    expect(featuredKeyAction("Enter", "B", false, true)).toBe("none");
    expect(removeLastFeatured(["B", "C"])).toEqual(["B"]);
    expect(removeLastFeatured([])).toEqual([]);
  });

  it("joins the names as joinFeaturing does", () => {
    expect(featuringText(["B"])).toBe("feat. B");
    expect(featuringText(["B", "C"])).toBe("feat. B & C");
    expect(featuringText(["B", "C", "D"])).toBe("feat. B, C & D");
    expect(featuringText([])).toBe("");
  });
});

describe("the editor split and join", () => {
  it("round-trips with features, with none, and with Sunn O)))", () => {
    expect(toEditor("Song (feat. B & C)")).toEqual({ title: "Song", featuring: ["B", "C"] });
    expect(fromEditor("Song", ["B", "C"])).toBe("Song (feat. B & C)");
    expect(toEditor("Song")).toEqual({ title: "Song", featuring: [] });
    expect(fromEditor("Song", [])).toBe("Song");
    expect(fromEditor("Song", ["Sunn O)))"])).toBe("Song (feat. Sunn O))))");
    expect(toEditor("Song (feat. Sunn O))))")).toEqual({ title: "Song", featuring: ["Sunn O)))"] });
    expect(toEditor("Sunn O)))")).toEqual({ title: "Sunn O)))", featuring: [] });
  });

  it("saves a re-capitalised name, which is a change", () => {
    expect(titleForSave("Song (feat. bianca)", "Song", ["Bianca"])).toBe("Song (feat. Bianca)");
    expect(titleForSave("Song (feat. Bianca)", "Song", ["Bianca"])).toBe("Song (feat. Bianca)");
  });

  it("keeps typed text when the input loses focus, and drops a blank or duplicate draft", () => {
    expect(commitDraft(["Bianca"], " Dana ")).toEqual({ names: ["Bianca", "Dana"], draft: "" });
    expect(commitDraft(["Bianca"], "bianca").names).toEqual(["Bianca"]);
    expect(commitDraft(["Bianca"], "  ")).toEqual({ names: ["Bianca"], draft: "" });
  });

  it("keeps a stored title the user did not touch, and writes the catalogue form once they do", () => {
    expect(titleForSave("Song feat. B", "Song", ["B"])).toBe("Song feat. B");
    expect(titleForSave("Song feat. B", "Song", ["B", "C"])).toBe("Song (feat. B & C)");
    expect(titleForSave("Song", "Song", [])).toBe("Song");
    expect(titleForSave(undefined, "Song", ["B"])).toBe("Song (feat. B)");
  });
});

describe("an inspected file on import", () => {
  it("splits an artist tag 'A feat. B' into artist A and features [B]", () => {
    expect(fromInspected({ artist: "A feat. B", title: "Song" }, "song.mp3")).toEqual({
      artist: "A",
      title: "Song",
      featuring: ["B"],
    });
  });

  it("merges with a title that already holds '(feat. X)', de-duplicated by key", () => {
    expect(fromInspected({ artist: "A feat. B", title: "Song (feat. X)" }, "f")).toEqual({
      artist: "A",
      title: "Song",
      featuring: ["X", "B"],
    });
    expect(fromInspected({ artist: "A ft. b", title: "Song (feat. B)" }, "f").featuring).toEqual(["B"]);
    expect(fromInspected({ artist: "A", title: "Song (feat. X)" }, "f")).toEqual({
      artist: "A",
      title: "Song",
      featuring: ["X"],
    });
  });

  it("falls back to the file name when there is no title tag", () => {
    expect(fromInspected({ artist: null, title: null }, "my song").title).toBe("my song");
  });
});

describe("saving featured artists writes the catalogue title and leaves the artist tag plain (#287)", () => {
  let libraryDir: string;
  let service: ReleaseService;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-featuring-"));
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

  const mp3 = (name: string) => new File([new Uint8Array(silentMp3())], name, { type: "audio/mpeg" });

  it("a single imported with title Song, artist A and features [B]: TIT2 'Song (feat. B)', TPE1 'A', release title plain", async () => {
    const imported = await service.import(
      {
        kind: "single",
        artist: "A",
        title: "Song",
        tracks: [{ title: fromEditor("Song", ["B"]), trackNumber: 1 }],
      } as never,
      null,
      [mp3("1.mp3")],
    );
    const tags = NodeID3.read(imported.tracks[0].filePath);
    expect(tags.title).toBe("Song (feat. B)");
    expect(tags.artist).toBe("A");
    expect(tags.album).toBe("Song");
    expect(imported.title).toBe("Song");
    expect(imported.tracks[0].title).toBe("Song (feat. B)");
  });

  it("a single edited on the release page: the plain title and names are joined by the patch", async () => {
    const imported = await service.import(
      { kind: "single", artist: "A", title: "Song", tracks: [{ title: "Song", trackNumber: 1 }] } as never,
      null,
      [mp3("1.mp3")],
    );
    const tracks = imported.tracks.map((t) => editableTrack(t, false));
    expect(tracks[0]).toMatchObject({ title: "Song", featuring: [] });
    const draftTracks = [{ ...tracks[0], featuring: ["B"] }];
    const patch = buildPatch(imported, { title: "Song", artist: "A", year: "", genre: "", tracks: draftTracks });
    expect(patch?.title).toBeUndefined();
    expect(patch?.tracks?.[0].title).toBe("Song (feat. B)");
    const saved = await service.update(imported.id, parseUpdateMeta(patch));
    const tags = NodeID3.read(saved.tracks[0].filePath);
    expect(tags.title).toBe("Song (feat. B)");
    expect(tags.artist).toBe("A");
    expect(tags.album).toBe("Song");
    // Reopened, it shows split and is not an unsaved change.
    const reopened = saved.tracks.map((t) => editableTrack(t, false));
    expect(reopened[0]).toMatchObject({ title: "Song", featuring: ["B"] });
    expect(buildPatch(saved, { title: saved.title, artist: "A", year: "", genre: "", tracks: reopened })).toBeNull();
  });

  it("an album track gets the joined title; its neighbour and the album title stay plain", async () => {
    const imported = await service.import(
      {
        kind: "album",
        artist: "A",
        title: "Album",
        tracks: [
          { title: "One", trackNumber: 1 },
          { title: "Two", trackNumber: 2 },
        ],
      } as never,
      null,
      [mp3("1.mp3"), mp3("2.mp3")],
    );
    const editable = imported.tracks.map((t) => editableTrack(t, false));
    // The row edits go through the same applyTrackEdits the import page uses.
    const edited = applyTrackEdits(editable, [editable[0], { ...editable[1], featuring: ["B", "C"] }]);
    const patch = buildPatch(imported, { title: "Album", artist: "A", year: "", genre: "", tracks: edited });
    expect(patch?.tracks).toHaveLength(1);
    const saved = await service.update(imported.id, parseUpdateMeta(patch));
    const [one, two] = saved.tracks.map((t) => NodeID3.read(t.filePath));
    expect(one.title).toBe("One");
    expect(two.title).toBe("Two (feat. B & C)");
    expect(two.artist).toBe("A");
    expect(two.album).toBe("Album");
    expect(saved.title).toBe("Album");
  });

  it("opening and saving a release with a title in another form does not rewrite it", () => {
    const release = {
      id: "r",
      kind: "album",
      title: "Album",
      artist: "A",
      year: null,
      genre: null,
      coverPath: null,
      folderPath: "/lib",
      tracks: [{ id: "t1", title: "Song feat. B", trackNumber: 1, filePath: "/lib/1.mp3", originalName: "1.mp3", durationSec: null }],
      createdAt: "x",
      updatedAt: "x",
    } as Release;
    const tracks = release.tracks.map((t) => editableTrack(t, false));
    expect(buildPatch(release, { title: "Album", artist: "A", year: "", genre: "", tracks })).toBeNull();
  });

  it("an adopted release keeps its titles whole", () => {
    expect(editableTrack({ id: "t", title: "Song (feat. B)" }, true)).toEqual({
      key: "t",
      title: "Song (feat. B)",
      discNumber: undefined,
    });
  });
});
