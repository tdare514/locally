import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalFilesIndexDetector,
  indexContainsLibrary,
} from "../../src/server/spotify/SpotifySourceDetector";

describe("indexContainsLibrary", () => {
  it("matches a path inside the library dir", () => {
    const index = Buffer.from(
      "junk\x00\x01/tmp/lib/artist/album/01 - song.mp3\x00more junk",
      "utf-8"
    );
    expect(indexContainsLibrary(index, "/tmp/lib")).toBe(true);
  });

  it("does not match a different library dir, even with a shared prefix", () => {
    const index = Buffer.from("binary junk /tmp/library2/x.mp3 more junk", "utf-8");
    expect(indexContainsLibrary(index, "/tmp/lib")).toBe(false);
  });

  it("does not match when the index has no library paths at all", () => {
    const index = Buffer.from("\x00\x01\x02completely unrelated bytes\x03\x04", "utf-8");
    expect(indexContainsLibrary(index, "/tmp/lib")).toBe(false);
  });
});

describe("LocalFilesIndexDetector", () => {
  let tmpDir: string;
  let usersDir: string;
  let fakeLibraryDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spotify-source-detector-"));
    usersDir = path.join(tmpDir, "Users");
    fakeLibraryDir = path.join(tmpDir, "Music", "Spotify Local Import");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when a user's index contains a path under the library dir", async () => {
    const userDir = path.join(usersDir, "abc-user");
    await fs.mkdir(userDir, { recursive: true });
    const indexed = path.join(fakeLibraryDir, "artist", "album", "01 - song.mp3");
    await fs.writeFile(
      path.join(userDir, "local-files.bnk"),
      Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from(indexed, "utf-8"), Buffer.from([0x03, 0x04])])
    );

    const detector = new LocalFilesIndexDetector(usersDir);
    expect(await detector.isWatching(fakeLibraryDir)).toBe(true);
  });

  it("returns false for a different library dir", async () => {
    const userDir = path.join(usersDir, "abc-user");
    await fs.mkdir(userDir, { recursive: true });
    const indexed = path.join(fakeLibraryDir, "artist", "album", "01 - song.mp3");
    await fs.writeFile(path.join(userDir, "local-files.bnk"), Buffer.from(indexed, "utf-8"));

    const detector = new LocalFilesIndexDetector(usersDir);
    expect(await detector.isWatching(path.join(tmpDir, "Music", "Other Folder"))).toBe(false);
  });

  it("returns false when the Users dir has no subfolders", async () => {
    await fs.mkdir(usersDir, { recursive: true });
    const detector = new LocalFilesIndexDetector(usersDir);
    expect(await detector.isWatching(fakeLibraryDir)).toBe(false);
  });

  it("returns false when the Users dir is missing entirely", async () => {
    const detector = new LocalFilesIndexDetector(path.join(tmpDir, "does-not-exist"));
    expect(await detector.isWatching(fakeLibraryDir)).toBe(false);
  });
});
