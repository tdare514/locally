import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InspectService } from "../../src/server/releases/InspectService";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import type { ReadTagsResult, TagService } from "../../src/server/audio/TagService";

/** Fake tag reader: returns a canned result per file name, or throws for names in `failFor`. */
class FakeTagService implements TagService {
  failFor = new Set<string>();
  readCalls: string[] = [];

  async write(): Promise<void> {
    throw new Error("not used by InspectService");
  }

  async read(filePath: string): Promise<ReadTagsResult> {
    this.readCalls.push(filePath);
    if (this.failFor.has(path.basename(filePath))) {
      throw new Error(`simulated read failure for ${filePath}`);
    }
    return {
      title: "Some Title",
      artist: "Some Artist",
      album: "Some Album",
      year: "2024",
      genre: "Electronic",
      durationSec: 180.5,
      hasCover: true,
    };
  }
}

function audioFile(name: string, content = "fake audio bytes"): File {
  return new File([content], name, { type: "audio/mpeg" });
}

describe("InspectService.inspect", () => {
  let tags: FakeTagService;
  let fsImpl: NodeFileSystem;
  let service: InspectService;
  let tempDirsMade: string[];

  beforeEach(() => {
    tags = new FakeTagService();
    fsImpl = new NodeFileSystem();
    tempDirsMade = [];
    // Spy on makeTempDir so the test can assert the scratch dir is cleaned up.
    const original = fsImpl.makeTempDir.bind(fsImpl);
    vi.spyOn(fsImpl, "makeTempDir").mockImplementation(async (prefix) => {
      const dir = await original(prefix);
      tempDirsMade.push(dir);
      return dir;
    });
    service = new InspectService(tags, fsImpl);
  });

  afterEach(async () => {
    for (const dir of tempDirsMade) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("reads tags for each uploaded file and returns them keyed by original name", async () => {
    const files = [audioFile("track-a.mp3"), audioFile("track-b.mp3")];

    const result = await service.inspect(files);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "track-a.mp3",
      title: "Some Title",
      artist: "Some Artist",
      album: "Some Album",
      year: "2024",
      genre: "Electronic",
      durationSec: 180.5,
      hasCover: true,
    });
    expect(result[1].name).toBe("track-b.mp3");
    expect(tags.readCalls).toHaveLength(2);
  });

  it("falls back to null fields for a file whose tags fail to read, without failing the whole batch", async () => {
    tags.failFor.add("f-0.mp3");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await service.inspect([audioFile("bad.mp3"), audioFile("good.mp3")]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "bad.mp3",
      title: null,
      artist: null,
      album: null,
      year: null,
      genre: null,
      durationSec: null,
      hasCover: false,
    });
    expect(result[1].title).toBe("Some Title");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("removes the scratch temp dir after inspecting, even when a read fails", async () => {
    tags.failFor.add("f-0.mp3");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await service.inspect([audioFile("bad.mp3")]);

    expect(tempDirsMade).toHaveLength(1);
    await expect(fs.access(tempDirsMade[0])).rejects.toThrow();
  });

  it("saves each upload to a distinct temp path derived from its extension", async () => {
    await service.inspect([audioFile("one.flac"), audioFile("two.wav")]);

    expect(tags.readCalls[0]).toContain("f-0.flac");
    expect(tags.readCalls[1]).toContain("f-1.wav");
    expect(path.dirname(tags.readCalls[0])).toBe(path.dirname(tags.readCalls[1]));
  });

  it("returns an empty list for an empty input without creating extra state", async () => {
    const result = await service.inspect([]);
    expect(result).toEqual([]);
  });

  it("uses the OS temp dir, never a real user directory", async () => {
    await service.inspect([audioFile("x.mp3")]);
    expect(tempDirsMade[0].startsWith(os.tmpdir())).toBe(true);
  });
});
