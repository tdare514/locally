import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../../../src/server/container";
import type { Release, Settings, UpdateReleaseMeta } from "../../../src/shared/types";
import { NotFoundError, ValidationError } from "../../../src/shared/errors";
import { NodeFileSystem } from "../../../src/server/fs/NodeFileSystem";

let services: Services;

vi.mock("../../../src/server/container", () => ({
  getServices: () => services,
}));

import { GET, PATCH, DELETE } from "../../../src/app/api/releases/[id]/route";
import { GET as coverGET } from "../../../src/app/api/releases/[id]/cover/route";

function sampleRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "rel-1",
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/tmp/lib/Artist/Title",
    tracks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

let getCalls: string[];
let updateCalls: { id: string; patch: UpdateReleaseMeta }[];
let deleteCalls: string[];
let releaseToReturn: Release | null;
let updateResult: Release;
let updateError: Error | null;
let deleteError: Error | null;

class FakeReleaseService {
  async get(id: string): Promise<Release | null> {
    getCalls.push(id);
    return releaseToReturn;
  }
  async update(id: string, patch: UpdateReleaseMeta): Promise<Release> {
    updateCalls.push({ id, patch });
    if (updateError) throw updateError;
    return updateResult;
  }
  async delete(id: string): Promise<void> {
    deleteCalls.push(id);
    if (deleteError) throw deleteError;
  }
}

let settingsValue: Settings;
class FakeSettingsStore {
  async get(): Promise<Settings> {
    return settingsValue;
  }
  async set(next: Settings): Promise<Settings> {
    settingsValue = next;
    return next;
  }
}

beforeEach(() => {
  getCalls = [];
  updateCalls = [];
  deleteCalls = [];
  releaseToReturn = sampleRelease();
  updateResult = sampleRelease({ title: "Updated Title" });
  updateError = null;
  deleteError = null;
  settingsValue = { libraryDir: "/tmp/lib", sync: null };
  services = {
    releases: new FakeReleaseService(),
    settings: new FakeSettingsStore(),
    fs: new NodeFileSystem(),
  } as unknown as Services;
});

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/releases/rel-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/releases/[id]", () => {
  it("returns the release when found", async () => {
    const res = await GET(new NextRequest("http://localhost/api/releases/rel-1"), params("rel-1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Release;
    expect(body.id).toBe("rel-1");
    expect(getCalls).toEqual(["rel-1"]);
  });

  it("returns 404 when the release does not exist", async () => {
    releaseToReturn = null;

    const res = await GET(new NextRequest("http://localhost/api/releases/missing"), params("missing"));

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/releases/[id]", () => {
  it("updates a release with a valid patch", async () => {
    const res = await PATCH(patchRequest({ title: "Updated Title" }), params("rel-1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Release;
    expect(body.title).toBe("Updated Title");
    expect(updateCalls).toEqual([{ id: "rel-1", patch: { title: "Updated Title" } }]);
  });

  it("rejects a patch body that fails schema validation (400)", async () => {
    const res = await PATCH(patchRequest({ year: "not-a-year" }), params("rel-1"));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a non-object body (400)", async () => {
    const res = await PATCH(patchRequest("just a string"), params("rel-1"));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 404 when the service reports the release doesn't exist", async () => {
    updateError = new NotFoundError("Release rel-1 not found");

    const res = await PATCH(patchRequest({ title: "X" }), params("rel-1"));

    expect(res.status).toBe(404);
  });

  it("surfaces a ValidationError from the service (e.g. a name resolving outside the library) as 400", async () => {
    updateError = new ValidationError("resulting path escapes the library directory");

    const res = await PATCH(patchRequest({ title: "../../evil" }), params("rel-1"));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("resulting path escapes the library directory");
  });
});

describe("DELETE /api/releases/[id]", () => {
  it("deletes an existing release", async () => {
    const res = await DELETE(new NextRequest("http://localhost/api/releases/rel-1", { method: "DELETE" }), params("rel-1"));

    expect(res.status).toBe(200);
    expect(deleteCalls).toEqual(["rel-1"]);
  });

  it("returns 404 when the release does not exist", async () => {
    deleteError = new NotFoundError("Release rel-1 not found");

    const res = await DELETE(new NextRequest("http://localhost/api/releases/rel-1", { method: "DELETE" }), params("rel-1"));

    expect(res.status).toBe(404);
  });
});

describe("GET /api/releases/[id]/cover", () => {
  let rootDir: string;
  let libraryDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-cover-route-"));
    libraryDir = path.join(rootDir, "library");
    await fs.mkdir(libraryDir);
    settingsValue = { libraryDir, sync: null };
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("serves the cover bytes when the cover path is inside the library dir", async () => {
    const coverPath = path.join(libraryDir, "Artist", "Title", "cover.jpg");
    await fs.mkdir(path.dirname(coverPath), { recursive: true });
    await fs.writeFile(coverPath, Buffer.from([1, 2, 3, 4]));
    releaseToReturn = sampleRelease({ coverPath });

    const res = await coverGET(new NextRequest("http://localhost/api/releases/rel-1/cover"), params("rel-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("refuses to serve a cover path that escapes the library directory (404, not the file)", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-cover-outside-"));
    const outsidePath = path.join(outsideDir, "secret.jpg");
    await fs.writeFile(outsidePath, Buffer.from([1, 2, 3, 4]));
    releaseToReturn = sampleRelease({ coverPath: outsidePath });

    const res = await coverGET(new NextRequest("http://localhost/api/releases/rel-1/cover"), params("rel-1"));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("This release has no cover image");

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("refuses a cover path using .. segments to climb out of the library dir", async () => {
    const coverPath = path.join(libraryDir, "..", "outside-cover.jpg");
    await fs.writeFile(coverPath, Buffer.from([1, 2, 3, 4]));
    releaseToReturn = sampleRelease({ coverPath });

    const res = await coverGET(new NextRequest("http://localhost/api/releases/rel-1/cover"), params("rel-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when the release has no cover", async () => {
    releaseToReturn = sampleRelease({ coverPath: null });

    const res = await coverGET(new NextRequest("http://localhost/api/releases/rel-1/cover"), params("rel-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 when the release itself does not exist", async () => {
    releaseToReturn = null;

    const res = await coverGET(new NextRequest("http://localhost/api/releases/missing/cover"), params("missing"));

    expect(res.status).toBe(404);
  });
});
