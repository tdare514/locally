import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import NodeID3 from "node-id3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdoptScanner } from "../../src/server/adopt/AdoptScanner";
import { FileAdoptProposalStore } from "../../src/server/adopt/FileAdoptProposalStore";
import { buildLocalId } from "../../src/server/adopt/localId";
import { FileSettingsStore } from "../../src/server/config/FileSettingsStore";
import { JsonLibraryRepository } from "../../src/server/storage/JsonLibraryRepository";
import { decodeLocalId } from "../../src/server/plays/LocalTrackResolver";
import type { Release } from "../../src/shared/types";

const run = promisify(execFile);

/** Ten silent MPEG-1 Layer III frames, as in Id3TagService.test.ts. */
function silentMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 10 }, () => frame));
}

const hasFfmpeg = await run("ffmpeg", ["-version"]).then(
  () => true,
  () => false
);

let base: string;
let root: string;
let libDir: string;
let configDir: string;
let originalEnv: string | undefined;
let repo: JsonLibraryRepository;

beforeEach(async () => {
  originalEnv = process.env.LOCALLY_CONFIG_DIR;
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sli-adopt-")));
  root = path.join(base, "Spotify Music");
  libDir = path.join(base, "Library");
  configDir = path.join(base, "config");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(libDir, { recursive: true });
  process.env.LOCALLY_CONFIG_DIR = configDir;
  repo = new JsonLibraryRepository();
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.LOCALLY_CONFIG_DIR;
  else process.env.LOCALLY_CONFIG_DIR = originalEnv;
  await fs.rm(base, { recursive: true, force: true });
});

interface Mp3Tags {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  track?: string;
  disc?: string;
  year?: string;
  genre?: string;
  image?: boolean;
}

async function writeMp3(file: string, t: Mp3Tags = {}): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, silentMp3());
  const tags: NodeID3.Tags = {
    title: t.title,
    artist: t.artist,
    performerInfo: t.albumArtist,
    album: t.album,
    trackNumber: t.track,
    partOfSet: t.disc,
    year: t.year,
    genre: t.genre,
  };
  if (t.image) {
    tags.image = {
      mime: "image/png",
      type: { id: 3, name: "front cover" },
      description: "Cover",
      imageBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    };
  }
  const res = NodeID3.write(tags, file);
  if (res instanceof Error) throw res;
  return file;
}

function scanner(): AdoptScanner {
  return new AdoptScanner({ library: repo, libraryDir: libDir });
}

async function snapshot(dir: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const walk = async (d: string) => {
    out[d] = (await fs.lstat(d)).mtimeMs;
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[p] = (await fs.lstat(p)).mtimeMs;
    }
  };
  await walk(dir);
  return out;
}

describe("AdoptScanner grouping", () => {
  it("groups three tracks of one album, ordered by track number, with year, genre and cover", async () => {
    const dir = path.join(root, "Album One");
    await writeMp3(path.join(dir, "c.mp3"), { title: "Three", artist: "Band", albumArtist: "Band", album: "Rec", track: "3/3" });
    await writeMp3(path.join(dir, "a.mp3"), { title: "One", artist: "Band", albumArtist: "Band", album: "Rec", track: "1/3", year: "2021", genre: "Rock", image: true });
    await writeMp3(path.join(dir, "b.mp3"), { title: "Two", artist: "Band", albumArtist: "Band", album: "Rec", track: "2/3" });

    const proposal = await scanner().scan([root]);
    expect(proposal.groups).toHaveLength(1);
    const g = proposal.groups[0];
    expect(g).toMatchObject({ kind: "album", title: "Rec", artist: "Band", year: "2021", genre: "Rock", folder: path.join(await fs.realpath(root), "Album One") });
    expect(g.tracks.map((t) => t.title)).toEqual(["One", "Two", "Three"]);
    expect(g.tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3]);
    expect(g.coverFrom).toBe(g.tracks[0].path);
    expect(g.tracks[0].durationSec).toBeGreaterThan(0);
    expect(proposal.roots).toEqual([await fs.realpath(root)]);
  });

  it("uses the most common artist when there is no album artist", async () => {
    const dir = path.join(root, "x");
    await writeMp3(path.join(dir, "1.mp3"), { title: "A", artist: "Main", album: "Mix", track: "1" });
    await writeMp3(path.join(dir, "2.mp3"), { title: "B", artist: "Main", album: "Mix", track: "2" });
    await writeMp3(path.join(dir, "3.mp3"), { title: "C", artist: "Guest", album: "Mix", track: "3" });
    const [g] = (await scanner().scan([root])).groups;
    expect(g.kind).toBe("album");
    expect(g.artist).toBe("Main");
  });

  it("makes a lone tagged file a single", async () => {
    await writeMp3(path.join(root, "s", "solo.mp3"), { title: "Solo", artist: "Her", album: "Solo EP", track: "1" });
    const [g] = (await scanner().scan([root])).groups;
    expect(g).toMatchObject({ kind: "single", title: "Solo EP", artist: "Her" });
    expect(g.tracks).toHaveLength(1);
  });

  it("makes a file with no album tag its own single, titled from the title tag or the file name", async () => {
    const dir = path.join(root, "loose");
    await writeMp3(path.join(dir, "named.mp3"), { title: "Has Title", artist: "Ann" });
    await writeMp3(path.join(dir, "just a file.mp3"), { artist: "Ann" });
    const { groups } = await scanner().scan([root]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
    expect(groups.map((g) => g.title).sort()).toEqual(["Has Title", "just a file"]);
    const noAlbum = groups.find((g) => g.title === "just a file")!;
    expect(noAlbum.tracks[0].localId).toBe(buildLocalId("Ann", "", "just a file", noAlbum.tracks[0].durationSec));
    expect(decodeLocalId(noAlbum.tracks[0].localId)?.album).toBe("");
  });

  it("keeps the same album in two folders as two groups with different keys", async () => {
    for (const folder of ["Masters", "Unmastered"]) {
      for (const n of [1, 2]) {
        await writeMp3(path.join(root, folder, `${n}.mp3`), { title: `T${n}`, artist: "Band", albumArtist: "Band", album: "Rec", track: String(n) });
      }
    }
    const { groups } = await scanner().scan([root]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    expect(groups.every((g) => g.kind === "album" && g.title === "Rec")).toBe(true);

    const again = await scanner().scan([root]);
    expect(again.groups.map((g) => g.key)).toEqual(groups.map((g) => g.key));
  });

  it("reads the disc tag and orders by disc, then track", async () => {
    const dir = path.join(root, "double");
    await writeMp3(path.join(dir, "d2t1.mp3"), { title: "D2T1", artist: "B", albumArtist: "B", album: "Two Discs", track: "1/1", disc: "2/2" });
    await writeMp3(path.join(dir, "d1t2.mp3"), { title: "D1T2", artist: "B", albumArtist: "B", album: "Two Discs", track: "2/2", disc: "1/2" });
    await writeMp3(path.join(dir, "d1t1.mp3"), { title: "D1T1", artist: "B", albumArtist: "B", album: "Two Discs", track: "1/2", disc: "1/2" });
    const [g] = (await scanner().scan([root])).groups;
    expect(g.tracks.map((t) => t.title)).toEqual(["D1T1", "D1T2", "D2T1"]);
    expect(g.tracks.map((t) => t.discNumber)).toEqual([1, 1, 2]);
  });

  it.skipIf(!hasFfmpeg)("reads m4a tags and length", async () => {
    const dir = path.join(root, "m4a");
    await fs.mkdir(dir, { recursive: true });
    for (const n of [1, 2]) {
      await run("ffmpeg", [
        "-y", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac",
        "-metadata", `title=Song ${n}`, "-metadata", "artist=M Artist", "-metadata", "album_artist=M Artist",
        "-metadata", "album=M Album", "-metadata", `track=${n}/2`, "-metadata", "disc=1/1", "-metadata", "date=2019", "-metadata", "genre=Pop",
        path.join(dir, `${n}.m4a`),
      ]);
    }
    const [g] = (await scanner().scan([root])).groups;
    expect(g).toMatchObject({ kind: "album", title: "M Album", artist: "M Artist", year: "2019", genre: "Pop" });
    expect(g.tracks.map((t) => t.title)).toEqual(["Song 1", "Song 2"]);
    expect(g.tracks[0].discNumber).toBe(1);
    expect(g.tracks[0].durationSec).toBeGreaterThan(1.5);
    expect(g.tracks[0].localId).toBe(buildLocalId("M Artist", "M Album", "Song 1", g.tracks[0].durationSec));
  });
});

describe("localId", () => {
  it("encodes spaces as +, and : + and non-ASCII as percent escapes, and round-trips decodeLocalId", () => {
    const id = buildLocalId("AC:DC & Co", "A+B Album", "Café Déjà vu", 213.6);
    expect(id).toBe("spotify:local:AC%3ADC+%26+Co:A%2BB+Album:Caf%C3%A9+D%C3%A9j%C3%A0+vu:213");
    expect(decodeLocalId(id)).toEqual({ artist: "AC:DC & Co", album: "A+B Album", title: "Café Déjà vu", seconds: 213 });
  });

  it("round-trips through a scanned file with awkward tags", async () => {
    await writeMp3(path.join(root, "f", "x.mp3"), { title: "Title: Part+1 ü", artist: "Ärtist Name", album: "Al:bum", track: "1" });
    const [g] = (await scanner().scan([root])).groups;
    const decoded = decodeLocalId(g.tracks[0].localId);
    expect(decoded).toMatchObject({ artist: "Ärtist Name", album: "Al:bum", title: "Title: Part+1 ü" });
    expect(decoded?.seconds).toBe(Math.floor(g.tracks[0].durationSec));
  });
});

describe("AdoptScanner skipping and safety", () => {
  it("skips hidden entries, non-audio files (counted by extension) and files already in the library", async () => {
    await writeMp3(path.join(root, "keep.mp3"), { title: "Keep", artist: "A", album: "K" });
    await writeMp3(path.join(root, ".hidden.mp3"), { title: "Hidden", artist: "A" });
    await writeMp3(path.join(root, ".hiddendir", "x.mp3"), { title: "H2", artist: "A" });
    const inLib = await writeMp3(path.join(root, "owned.mp3"), { title: "Owned", artist: "A", album: "O" });
    await fs.writeFile(path.join(root, "a.flac"), "x");
    await fs.writeFile(path.join(root, "b.FLAC"), "x");
    await fs.writeFile(path.join(root, "notes.txt"), "x");
    await fs.writeFile(path.join(root, "Makefile"), "x");

    const release = {
      id: "r1", kind: "single", title: "O", artist: "A", year: null, genre: null, coverPath: null, folderPath: root,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      tracks: [{ id: "t1", title: "Owned", trackNumber: 1, filePath: inLib, originalName: "owned.mp3", durationSec: 1 }],
    } as unknown as Release;
    await repo.upsert(libDir, release);

    const p = await scanner().scan([root]);
    expect(p.groups.map((g) => g.title)).toEqual(["K"]);
    expect(p.skipped).toEqual({ ".flac": 2, ".txt": 1, "(none)": 1 });
  });

  it("skips Locally's library folder when it sits inside a root", async () => {
    const inner = path.join(root, "Library");
    await writeMp3(path.join(inner, "lib.mp3"), { title: "Lib", artist: "A", album: "L" });
    await writeMp3(path.join(root, "real.mp3"), { title: "Real", artist: "A", album: "R" });
    const p = await new AdoptScanner({ library: repo, libraryDir: inner }).scan([root]);
    expect(p.groups.map((g) => g.title)).toEqual(["R"]);
    // a root that is the library itself scans nothing
    const q = await new AdoptScanner({ library: repo, libraryDir: inner }).scan([inner]);
    expect(q.groups).toEqual([]);
    expect(q.roots).toEqual([]);
  });

  it("does not read a file reached by a ../ path or a symlink that leaves the root", async () => {
    const outside = path.join(base, "outside");
    await writeMp3(path.join(outside, "secret.mp3"), { title: "Secret", artist: "X", album: "S" });
    await writeMp3(path.join(root, "inside.mp3"), { title: "Inside", artist: "A", album: "I" });
    await fs.symlink(outside, path.join(root, "linkdir"));
    await fs.symlink(path.join(outside, "secret.mp3"), path.join(root, "linkfile.mp3"));
    await fs.symlink(path.join("..", "outside"), path.join(root, "rel-link"));
    await fs.symlink(path.join(root, "inside.mp3"), path.join(root, "samelink.mp3"));

    const read: string[] = [];
    const { readAdoptTags } = await import("../../src/server/adopt/AdoptScanner");
    const s = new AdoptScanner({
      library: repo,
      libraryDir: libDir,
      readTags: async (f) => {
        read.push(f);
        return readAdoptTags(f);
      },
    });
    // the root itself is given with a ../ segment; it resolves to the real folder
    const viaDots = path.join(root, "..", path.basename(root));
    const p = await s.scan([viaDots]);
    expect(p.groups.map((g) => g.title)).toEqual(["I"]);
    expect(read.every((f) => f.startsWith(path.join(base, "Spotify Music") + path.sep))).toBe(true);
    expect(read.some((f) => f.includes("outside"))).toBe(false);
    expect(read).toHaveLength(1); // the in-root symlink to inside.mp3 is not read twice
  });

  it("does not follow a directory symlink loop", async () => {
    await writeMp3(path.join(root, "a", "x.mp3"), { title: "X", artist: "A", album: "Loop" });
    await fs.symlink(root, path.join(root, "a", "back"));
    const p = await scanner().scan([root]);
    expect(p.groups).toHaveLength(1);
  });

  it("never writes inside a root (mtimes of every file and folder are unchanged)", async () => {
    await writeMp3(path.join(root, "a", "1.mp3"), { title: "1", artist: "A", album: "W", track: "1" });
    await writeMp3(path.join(root, "a", "2.mp3"), { title: "2", artist: "A", album: "W", track: "2" });
    await fs.writeFile(path.join(root, "a", "z.txt"), "x");
    const before = await snapshot(root);
    const p = await scanner().scan([root]);
    await new FileAdoptProposalStore().save(p);
    expect(await snapshot(root)).toEqual(before);
  });

  it("ignores a root that does not exist", async () => {
    const p = await scanner().scan([path.join(base, "nope")]);
    expect(p).toMatchObject({ roots: [], groups: [], skipped: {} });
  });
});

describe("FileAdoptProposalStore", () => {
  it("saves the proposal in app data and reads it back", async () => {
    await writeMp3(path.join(root, "a", "1.mp3"), { title: "1", artist: "A", album: "P", track: "1" });
    const store = new FileAdoptProposalStore();
    expect(await store.load()).toBeNull();
    const p = await scanner().scan([root]);
    await store.save(p);
    expect(await fs.stat(path.join(configDir, "adopt-proposal.json"))).toBeTruthy();
    expect(await new FileAdoptProposalStore().load()).toEqual(p);
  });

  it("answers null for a corrupt file", async () => {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "adopt-proposal.json"), "{nope");
    expect(await new FileAdoptProposalStore().load()).toBeNull();
  });
});

describe("adoptRoots setting", () => {
  it("defaults to [] and keeps valid entries only", async () => {
    const store = new FileSettingsStore();
    const first = await store.get();
    expect(first.adoptRoots).toEqual([]);
    await fs.writeFile(
      path.join(configDir, "settings.json"),
      JSON.stringify({ libraryDir: libDir, sync: null, adoptRoots: ["/a", 5, "", "/b"] })
    );
    expect((await store.get()).adoptRoots).toEqual(["/a", "/b"]);
    await store.update((c) => ({ ...c, adoptRoots: ["/c"] }));
    expect((await new FileSettingsStore().get()).adoptRoots).toEqual(["/c"]);
  });
});
