import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";
import { ReleaseLayout } from "../../../src/server/releases/ReleaseLayout";
import { resolveTrackAudio } from "../../../src/server/releases/TrackAudio";

let services: Services;
vi.mock("../../../src/server/container", () => ({ getServices: () => services }));

import { GET } from "../../../src/app/api/releases/[id]/tracks/[trackId]/audio/route";

const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
let root: string;
let lib: string;
let spotify: string;
let settingsValue: Settings;
let releases: Release[];

function release(over: Partial<Release> & { id: string }, file: string, trackId = "t1"): Release {
  const now = new Date().toISOString();
  return {
    kind: "single",
    title: "T",
    artist: "A",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: path.dirname(file),
    tracks: [{ id: trackId, title: "T", trackNumber: 1, filePath: file, originalName: "x", durationSec: 40 }],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function call(id: string, trackId: string, range?: string) {
  const req = new Request("http://localhost/x", range ? { headers: { range } } : undefined);
  return GET(req as never, { params: Promise.resolve({ id, trackId }) });
}

beforeEach(async () => {
  delete process.env.LOCALLY_DEMO;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sli-audio-route-"));
  lib = path.join(root, "lib");
  spotify = path.join(root, "spotify");
  await fs.mkdir(path.join(lib, "A", "T"), { recursive: true });
  await fs.mkdir(path.join(spotify, "Band"), { recursive: true });
  await fs.writeFile(path.join(lib, "A", "T", "01 - T.mp3"), BYTES);
  await fs.writeFile(path.join(spotify, "Band", "song.m4a"), BYTES);
  await fs.writeFile(path.join(root, "secret.mp3"), "secret");
  settingsValue = { libraryDir: lib, sync: null, adoptRoots: [spotify] } as Settings;
  releases = [
    release({ id: "r1" }, path.join(lib, "A", "T", "01 - T.mp3")),
    release({ id: "adopted", adopted: true }, path.join(spotify, "Band", "song.m4a")),
    release({ id: "gone" }, path.join(lib, "A", "T", "nope.mp3")),
    release({ id: "outside" }, path.join(root, "secret.mp3")),
    release({ id: "traversal" }, path.join(lib, "..", "secret.mp3")),
    release({ id: "adopted-outside", adopted: true }, path.join(root, "secret.mp3")),
  ];
  await fs.symlink(path.join(root, "secret.mp3"), path.join(lib, "A", "T", "link.mp3"));
  releases.push(release({ id: "link" }, path.join(lib, "A", "T", "link.mp3")));
  services = {
    settings: { get: async () => settingsValue },
    library: { find: async (_dir: string, id: string) => releases.find((r) => r.id === id) ?? null },
    layout: new ReleaseLayout(),
  } as unknown as Services;
});

afterEach(async () => {
  delete process.env.LOCALLY_DEMO;
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("GET /api/releases/[id]/tracks/[trackId]/audio", () => {
  it("streams the whole file with 200 and the audio headers", async () => {
    const res = await call("r1", "t1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("answers a Range with 206, Content-Range and just those bytes", async () => {
    const res = await call("r1", "t1", "bytes=100-199");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(100, 200))).toBe(true);
  });

  it("handles open-ended and suffix ranges", async () => {
    const open = await call("r1", "t1", "bytes=990-");
    expect(open.headers.get("Content-Range")).toBe("bytes 990-999/1000");
    const suffix = await call("r1", "t1", "bytes=-10");
    expect(suffix.headers.get("Content-Range")).toBe("bytes 990-999/1000");
  });

  it.each(["bytes=5000-6000", "bytes=abc", "items=0-5", "bytes=10-5", "bytes=0-1,5-6", "bytes=-", "bytes=1000-"])(
    "answers 416 for %s",
    async (range) => {
      const res = await call("r1", "t1", range);
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */1000");
    },
  );

  it("serves an adopted release's file in place, with its extension's type", async () => {
    const res = await call("adopted", "t1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mp4");
  });

  it("404s for an unknown release, an unknown track and a missing file", async () => {
    expect((await call("nope", "t1")).status).toBe(404);
    expect((await call("r1", "nope")).status).toBe(404);
    expect((await call("gone", "t1")).status).toBe(404);
  });

  it("refuses a file outside the library, a traversal and a symlink pointing out", async () => {
    for (const id of ["outside", "traversal", "link"]) {
      const res = await call(id, "t1");
      expect(res.status, id).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("secret");
    }
  });

  it("refuses an adopted release whose file is outside its Spotify folder", async () => {
    expect((await call("adopted-outside", "t1")).status).toBe(404);
  });

  it("refuses a library release whose file is in a Spotify folder", async () => {
    releases.push(release({ id: "mixed" }, path.join(spotify, "Band", "song.m4a")));
    expect((await call("mixed", "t1")).status).toBe(404);
  });

  it("403s in the demo", async () => {
    process.env.LOCALLY_DEMO = "1";
    expect((await call("r1", "t1")).status).toBe(403);
  });

  describe("a swap between the containment check and the open (#338)", () => {
    const file = () => path.join(lib, "A", "T", "01 - T.mp3");
    const resolve = (beforeOpen: () => Promise<void>) =>
      resolveTrackAudio(new ReleaseLayout(), lib, [], releases[0], "t1", { beforeOpen });

    it("serves the file when nothing is swapped, and closes nothing it did not open", async () => {
      const found = await resolve(async () => undefined);
      expect(found.size).toBe(1000);
      await found.handle.close();
    });

    it("404s when the file becomes a symlink pointing out", async () => {
      await expect(
        resolve(async () => {
          await fs.rm(file());
          await fs.symlink(path.join(root, "secret.mp3"), file());
        }),
      ).rejects.toThrow(/not available/);
    });

    it("404s when a folder above it becomes a symlink to a folder outside", async () => {
      const outside = path.join(root, "outside");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "01 - T.mp3"), "secret bytes");
      await expect(
        resolve(async () => {
          await fs.rename(path.join(lib, "A", "T"), path.join(lib, "A", "T-moved"));
          await fs.symlink(outside, path.join(lib, "A", "T"));
        }),
      ).rejects.toThrow(/not available/);
    });

    it("404s when the file is replaced by another file (a different inode)", async () => {
      await expect(
        resolve(async () => {
          await fs.writeFile(path.join(lib, "A", "T", "new.mp3"), "other");
          await fs.rename(path.join(lib, "A", "T", "new.mp3"), file());
        }),
      ).rejects.toThrow(/not available/);
    });
  });
});
