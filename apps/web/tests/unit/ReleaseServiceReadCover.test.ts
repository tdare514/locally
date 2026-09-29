import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseService } from "../../src/server/releases/ReleaseService";
import { NodeFileSystem } from "../../src/server/fs/NodeFileSystem";
import { NotFoundError } from "../../src/shared/errors";
import type { Release, Settings } from "../../src/shared/types";

let root: string;
let libraryDir: string;
let outsideDir: string;
let release: Release | null;
let service: ReleaseService;

function makeRelease(coverPath: string | null): Release {
  const now = new Date().toISOString();
  return {
    id: "r1",
    kind: "single",
    title: "T",
    artist: "A",
    year: null,
    genre: null,
    coverPath,
    folderPath: path.join(libraryDir, "A", "T"),
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function writeIn(dir: string, name: string, content = "bytes"): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, content);
  return file;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-read-cover-"));
  libraryDir = path.join(root, "lib");
  outsideDir = path.join(root, "outside");
  await fs.mkdir(libraryDir, { recursive: true });
  release = null;
  const settings = { get: async (): Promise<Settings> => ({ libraryDir, sync: null }), set: async (s: Settings) => s };
  const repo = { find: async () => release };
  service = new ReleaseService(
    settings as never,
    repo as never,
    {} as never,
    {} as never,
    new NodeFileSystem()
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("ReleaseService.readCover", () => {
  it("returns the bytes of a cover inside the library", async () => {
    const cover = await writeIn(path.join(libraryDir, "A", "T"), "cover.jpg", "jpeg-bytes");
    release = makeRelease(cover);
    const result = await service.readCover("r1");
    expect(result?.bytes.toString()).toBe("jpeg-bytes");
    expect(result?.contentType).toBe("image/jpeg");
  });

  it.each([
    ["cover.png", "image/png"],
    ["cover.PNG", "image/png"],
    ["cover.jpg", "image/jpeg"],
    ["cover.jpeg", "image/jpeg"],
    ["cover.bin", "image/jpeg"],
  ])("maps %s to %s", async (name, mime) => {
    release = makeRelease(await writeIn(path.join(libraryDir, "A", "T"), name));
    expect((await service.readCover("r1"))?.contentType).toBe(mime);
  });

  it("returns null when the release has no cover", async () => {
    release = makeRelease(null);
    expect(await service.readCover("r1")).toBeNull();
  });

  it("refuses (null) a cover path outside the library and never reads it", async () => {
    release = makeRelease(await writeIn(outsideDir, "secret.jpg", "should never be served"));
    expect(await service.readCover("r1")).toBeNull();
  });

  it("refuses a traversal path that lexically starts inside the library", async () => {
    await writeIn(outsideDir, "secret.jpg");
    release = makeRelease(path.join(libraryDir, "..", "outside", "secret.jpg"));
    expect(await service.readCover("r1")).toBeNull();
  });

  it("refuses the library directory itself", async () => {
    release = makeRelease(libraryDir);
    expect(await service.readCover("r1")).toBeNull();
  });

  it("throws NotFoundError when the release is unknown", async () => {
    await expect(service.readCover("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the cover file is missing on disk", async () => {
    release = makeRelease(path.join(libraryDir, "A", "T", "gone.jpg"));
    await expect(service.readCover("r1")).rejects.toThrow("Cover file is missing on disk");
  });
});
