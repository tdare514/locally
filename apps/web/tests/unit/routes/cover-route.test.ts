import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, Settings } from "../../../src/shared/types";
import type { Services } from "../../../src/server/container";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET } from "../../../src/app/api/releases/[id]/cover/route";

let settingsValue: Settings;
let releaseValue: Release | null;
let fileBytes: Buffer | null;

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

class FakeReleaseService {
  async get(): Promise<Release | null> {
    return releaseValue;
  }
}

/** Real `isInside` semantics (lexical only - good enough for these route tests). */
class FakeFileSystem {
  isInside(base: string, target: string): boolean {
    const rel = path.relative(base, target);
    return rel !== "" && !rel.startsWith("..");
  }
  async readFile(): Promise<Buffer> {
    if (!fileBytes) throw new Error("ENOENT");
    return fileBytes;
  }
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  const now = new Date().toISOString();
  return {
    id: "r1",
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/lib/Artist/Title",
    tracks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  settingsValue = { libraryDir: "/lib", sync: null };
  releaseValue = null;
  fileBytes = null;
  services = {
    settings: new FakeSettingsStore(),
    releases: new FakeReleaseService(),
    fs: new FakeFileSystem(),
  } as unknown as Services;
});

describe("GET /api/releases/[id]/cover", () => {
  it("404s when the release has no cover", async () => {
    releaseValue = makeRelease({ coverPath: null });
    const res = await GET(new Request("http://localhost") as never, paramsFor("r1"));
    expect(res.status).toBe(404);
  });

  it("serves the cover bytes when coverPath is inside the library dir", async () => {
    releaseValue = makeRelease({ coverPath: "/lib/Artist/Title/cover.jpg" });
    fileBytes = Buffer.from("jpeg-bytes");
    const res = await GET(new Request("http://localhost") as never, paramsFor("r1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("404s without leaking the path when coverPath points outside the library dir", async () => {
    releaseValue = makeRelease({ coverPath: "/etc/passwd" });
    fileBytes = Buffer.from("should never be served");
    const res = await GET(new Request("http://localhost") as never, paramsFor("r1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("passwd");
  });

  it("404s when coverPath equals the library dir itself", async () => {
    releaseValue = makeRelease({ coverPath: "/lib" });
    const res = await GET(new Request("http://localhost") as never, paramsFor("r1"));
    expect(res.status).toBe(404);
  });
});
