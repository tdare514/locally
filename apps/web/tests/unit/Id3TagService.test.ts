import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import NodeID3 from "node-id3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Id3TagService } from "../../src/server/audio/Id3TagService";

// A minimal mp3 built in memory: ten silent MPEG-1 Layer III frames (128 kbps,
// 44.1 kHz, 417 bytes each). Enough for `music-metadata` to parse, and it keeps
// the test independent of the gitignored repo-root fixtures.
function silentMp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  return Buffer.concat(Array.from({ length: 10 }, () => frame));
}

const PNG_HEADER_AND_BODY = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-id3-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Id3TagService", () => {
  it("writes then reads back title/artist/album/year/genre/track number", async () => {
    const mp3Path = path.join(tmpDir, "track.mp3");
    await fs.writeFile(mp3Path, silentMp3());

    const service = new Id3TagService();
    await service.write(mp3Path, {
      title: "My Track",
      artist: "My Artist",
      albumArtist: "My Artist",
      album: "My Album",
      trackNumber: 3,
      trackTotal: 10,
      year: "2024",
      genre: "Electronic",
    });

    const result = await service.read(mp3Path);
    expect(result.title).toBe("My Track");
    expect(result.artist).toBe("My Artist");
    expect(result.album).toBe("My Album");
    expect(result.year).toBe("2024");
    expect(result.genre).toBe("Electronic");
    expect(result.hasCover).toBe(false);
    expect(result.durationSec).not.toBeNull();
    expect(result.durationSec).toBeGreaterThan(0);
  });

  it("round-trips a per-disc track number and the disc number as TRCK and TPOS", async () => {
    const mp3Path = path.join(tmpDir, "disc.mp3");
    await fs.writeFile(mp3Path, silentMp3());

    const service = new Id3TagService();
    await service.write(mp3Path, {
      title: "Reprise",
      artist: "A",
      albumArtist: "A",
      album: "Double Feature",
      trackNumber: 1,
      trackTotal: 2,
      discNumber: 2,
      discTotal: 2,
    });

    const result = await service.read(mp3Path);
    expect(result.trackNumber).toBe(1);
    expect(result.trackTotal).toBe(2);
    expect(result.discNumber).toBe(2);
    expect(result.discTotal).toBe(2);
    expect(NodeID3.read(mp3Path).partOfSet).toBe("2/2");
    expect(NodeID3.read(mp3Path).trackNumber).toBe("1/2");
  });

  it("writes no TPOS when discs are not set, and reads the disc back as null", async () => {
    const mp3Path = path.join(tmpDir, "nodisc.mp3");
    await fs.writeFile(mp3Path, silentMp3());

    const service = new Id3TagService();
    await service.write(mp3Path, {
      title: "T",
      artist: "A",
      albumArtist: "A",
      album: "Z",
      trackNumber: 3,
      trackTotal: 10,
    });

    expect(NodeID3.read(mp3Path).partOfSet).toBeUndefined();
    expect(NodeID3.read(mp3Path).trackNumber).toBe("3/10");
    const result = await service.read(mp3Path);
    expect(result.trackNumber).toBe(3);
    expect(result.discNumber).toBeNull();
    expect(result.discTotal).toBeNull();
  });

  it("removes a TPOS already in the file when the next write sets no disc, and keeps the other tags", async () => {
    const mp3Path = path.join(tmpDir, "dropdisc.mp3");
    await fs.writeFile(mp3Path, silentMp3());
    const service = new Id3TagService();
    const base = { title: "T", artist: "A", albumArtist: "A", album: "Al", trackNumber: 1, trackTotal: 2 };

    await service.write(mp3Path, { ...base, discNumber: 2, discTotal: 2 });
    expect(NodeID3.read(mp3Path).raw).toHaveProperty("TPOS", "2/2");

    await service.write(mp3Path, base);

    const after = NodeID3.read(mp3Path);
    expect(after.raw).not.toHaveProperty("TPOS");
    expect(after.partOfSet).toBeUndefined();
    expect(after.title).toBe("T");
    expect(after.trackNumber).toBe("1/2");
    const result = await service.read(mp3Path);
    expect(result.discNumber).toBeNull();
    expect(result.discTotal).toBeNull();
  });

  it("removes a TPOS that came from somewhere else, such as a converted source file", async () => {
    const mp3Path = path.join(tmpDir, "foreigndisc.mp3");
    await fs.writeFile(mp3Path, silentMp3());
    NodeID3.write({ partOfSet: "1/3", title: "Old" }, mp3Path);

    await new Id3TagService().write(mp3Path, {
      title: "New",
      artist: "A",
      albumArtist: "A",
      album: "Al",
      trackNumber: 1,
      trackTotal: 1,
    });

    expect(NodeID3.read(mp3Path).raw).not.toHaveProperty("TPOS");
  });

  it("reads an out-of-range disc tag as null", async () => {
    const mp3Path = path.join(tmpDir, "baddisc.mp3");
    await fs.writeFile(mp3Path, silentMp3());
    NodeID3.write({ partOfSet: "0/0", trackNumber: "1/1" }, mp3Path);

    const result = await new Id3TagService().read(mp3Path);
    expect(result.discNumber).toBeNull();
  });

  it("round-trips a cover image, reflected as hasCover on read", async () => {
    const mp3Path = path.join(tmpDir, "with-cover.mp3");
    await fs.writeFile(mp3Path, silentMp3());
    const coverPath = path.join(tmpDir, "cover.png");
    await fs.writeFile(coverPath, PNG_HEADER_AND_BODY);

    const service = new Id3TagService();
    await service.write(mp3Path, {
      title: "Cover Track",
      artist: "Artist",
      albumArtist: "Artist",
      album: "Album",
      trackNumber: 1,
      trackTotal: 1,
      coverPath,
    });

    const result = await service.read(mp3Path);
    expect(result.hasCover).toBe(true);
    expect(result.title).toBe("Cover Track");
  });

  it("omits year/genre tags entirely when not provided", async () => {
    const mp3Path = path.join(tmpDir, "no-year.mp3");
    await fs.writeFile(mp3Path, silentMp3());

    const service = new Id3TagService();
    await service.write(mp3Path, {
      title: "No Year",
      artist: "Artist",
      albumArtist: "Artist",
      album: "Album",
      trackNumber: 1,
      trackTotal: 1,
    });

    const result = await service.read(mp3Path);
    expect(result.year).toBeNull();
    expect(result.genre).toBeNull();
  });

  it("rejects writing to a path that does not exist", async () => {
    const service = new Id3TagService();
    const missingPath = path.join(tmpDir, "does-not-exist.mp3");
    await expect(
      service.write(missingPath, {
        title: "X",
        artist: "Y",
        albumArtist: "Y",
        album: "Z",
        trackNumber: 1,
        trackTotal: 1,
      })
    ).rejects.toBeTruthy();
  });

  it("rejects reading tags when the format can't be determined at all", async () => {
    // music-metadata is lenient about content for a recognized `.mp3` extension (it falls back to
    // an empty-but-valid parse rather than throwing), so this uses an extension it can't map to
    // any known container/codec, to exercise the reject path `InspectService` catches.
    const junkPath = path.join(tmpDir, "not-audio.xyz");
    await fs.writeFile(junkPath, "this is definitely not an audio file, just plain text padding");

    const service = new Id3TagService();
    await expect(service.read(junkPath)).rejects.toBeTruthy();
  });

  it("does not throw reading tags off a non-audio file with a recognized .mp3 extension (music-metadata's leniency)", async () => {
    const junkPath = path.join(tmpDir, "not-really-audio.mp3");
    await fs.writeFile(junkPath, "this is definitely not an mp3 file, just plain text padding to be non-trivial");

    const service = new Id3TagService();
    const result = await service.read(junkPath);
    expect(result.title).toBeNull();
    expect(result.hasCover).toBe(false);
  });

  it("rejects reading tags from a missing file", async () => {
    const service = new Id3TagService();
    await expect(service.read(path.join(tmpDir, "missing.mp3"))).rejects.toBeTruthy();
  });
});

describe("Id3TagService release date (#221)", () => {
  const base = { title: "T", artist: "A", albumArtist: "A", album: "Al", trackNumber: 1, trackTotal: 1 };

  async function newMp3(): Promise<string> {
    const mp3Path = path.join(tmpDir, "date.mp3");
    await fs.writeFile(mp3Path, silentMp3());
    return mp3Path;
  }

  function raw(filePath: string) {
    const tags = NodeID3.read(filePath);
    return { year: tags.year, recordingTime: tags.recordingTime, date: tags.date };
  }

  it("a year alone writes TYER and TDRC as the year, and no TDAT", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024" });

    expect(raw(mp3Path)).toEqual({ year: "2024", recordingTime: "2024", date: undefined });
    const result = await service.read(mp3Path);
    expect(result.year).toBe("2024");
    expect(result.releaseDate).toBeNull();
  });

  it("a full date writes TYER as the year and TDRC as the date, and reads back", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2024-05-17" });

    expect(raw(mp3Path)).toEqual({ year: "2024", recordingTime: "2024-05-17", date: undefined });
    const result = await service.read(mp3Path);
    expect(result.year).toBe("2024");
    expect(result.releaseDate).toBe("2024-05-17");
  });

  it("a month writes TDRC as YYYY-MM and reads back at month precision", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2024-05" });

    expect(raw(mp3Path).recordingTime).toBe("2024-05");
    const result = await service.read(mp3Path);
    expect(result.year).toBe("2024");
    expect(result.releaseDate).toBe("2024-05");
  });

  it("shortening a full date to a year leaves TDRC as the year, with no day", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2024-05-17" });
    await service.write(mp3Path, { ...base, year: "2024" });

    expect(raw(mp3Path)).toEqual({ year: "2024", recordingTime: "2024", date: undefined });
    const result = await service.read(mp3Path);
    expect(result.year).toBe("2024");
    expect(result.releaseDate).toBeNull();
  });

  it("ignores a releaseDate that disagrees with the year", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2023-05-17" });

    expect(raw(mp3Path)).toEqual({ year: "2024", recordingTime: "2024", date: undefined });
  });

  it("clearing the year removes both TYER and TDRC", async () => {
    const mp3Path = await newMp3();
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2024-05-17" });
    await service.write(mp3Path, { ...base, year: null });

    expect(raw(mp3Path)).toEqual({ year: undefined, recordingTime: undefined, date: undefined });
    const result = await service.read(mp3Path);
    expect(result.year).toBeNull();
    expect(result.releaseDate).toBeNull();
  });

  it("keeps a tag Locally does not own through a date change", async () => {
    const mp3Path = await newMp3();
    NodeID3.write({ composer: "Someone", comment: { language: "eng", text: "keep me" } }, mp3Path);
    const service = new Id3TagService();
    await service.write(mp3Path, { ...base, year: "2024", releaseDate: "2024-05-17" });
    await service.write(mp3Path, { ...base, year: null });

    const tags = NodeID3.read(mp3Path);
    expect(tags.composer).toBe("Someone");
    expect(tags.comment?.text).toBe("keep me");
  });

  it("reads a TDRC with a time part as its date, and a file with only TYER as a year", async () => {
    const mp3Path = await newMp3();
    NodeID3.write({ recordingTime: "2024-05-17T07:00:00Z" }, mp3Path);
    const service = new Id3TagService();
    const timed = await service.read(mp3Path);
    expect(timed.year).toBe("2024");
    expect(timed.releaseDate).toBe("2024-05-17");

    const yearOnlyPath = path.join(tmpDir, "year-only.mp3");
    await fs.writeFile(yearOnlyPath, silentMp3());
    NodeID3.write({ year: "1999" }, yearOnlyPath);
    const yearOnly = await service.read(yearOnlyPath);
    expect(yearOnly.year).toBe("1999");
    expect(yearOnly.releaseDate).toBeNull();
  });

  it("reads TYER with TDAT (DDMM) as a full date", async () => {
    const mp3Path = await newMp3();
    NodeID3.write({ year: "2019", date: "0803" }, mp3Path);
    const result = await new Id3TagService().read(mp3Path);
    expect(result.year).toBe("2019");
    expect(result.releaseDate).toBe("2019-03-08");
  });

  it("falls back to the year when TDAT is not a real day, or is missing", async () => {
    const mp3Path = await newMp3();
    NodeID3.write({ year: "2024", date: "3102" }, mp3Path);
    const impossible = await new Id3TagService().read(mp3Path);
    expect(impossible.year).toBe("2024");
    expect(impossible.releaseDate).toBeNull();

    const yearOnlyPath = path.join(tmpDir, "no-tdat.mp3");
    await fs.writeFile(yearOnlyPath, silentMp3());
    NodeID3.write({ year: "2024" }, yearOnlyPath);
    const missing = await new Id3TagService().read(yearOnlyPath);
    expect(missing.year).toBe("2024");
    expect(missing.releaseDate).toBeNull();
  });
});
