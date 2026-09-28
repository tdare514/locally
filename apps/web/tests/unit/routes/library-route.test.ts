import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { Release, Settings } from "../../../src/shared/types";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET } from "../../../src/app/api/library/route";

let settingsValue: Settings;
let listCalls: string[];
let releasesToReturn: Release[];
let listError: Error | null;

class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

class FakeLibraryRepository {
  async list(libraryDir: string): Promise<Release[]> {
    listCalls.push(libraryDir);
    if (listError) throw listError;
    return releasesToReturn;
  }
}

function sampleRelease(id: string): Release {
  return {
    id,
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/tmp/lib/Artist/${id}`,
    tracks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  listCalls = [];
  releasesToReturn = [];
  listError = null;
  services = {
    settings: new FakeSettingsStore(),
    library: new FakeLibraryRepository(),
  } as unknown as Services;
});

describe("GET /api/library", () => {
  it("returns the versioned list of releases for the configured library dir", async () => {
    releasesToReturn = [sampleRelease("rel-1"), sampleRelease("rel-2")];

    const res = await GET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; releases: Release[] };
    expect(body.version).toBe(1);
    expect(body.releases).toHaveLength(2);
    expect(listCalls).toEqual(["/tmp/lib"]);
  });

  it("returns an empty list when the library has no releases", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { releases: Release[] };
    expect(body.releases).toEqual([]);
  });

  it("maps an unexpected repository error to a 500 without leaking its message", async () => {
    listError = new Error("ENOENT: /Users/someone/secret/path/library.json");

    const res = await GET();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("/Users/someone/secret/path");
  });
});
