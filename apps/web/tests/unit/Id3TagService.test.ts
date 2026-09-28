import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
