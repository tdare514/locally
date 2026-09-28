import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonLibraryRepository } from "../../src/server/storage/JsonLibraryRepository";
import { libraryFilePath } from "../../src/server/config/paths";
import type { Release } from "../../src/shared/types";

function makeRelease(overrides: Partial<Release> = {}): Release {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "single",
    title: "Title",
    artist: "Artist",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/nowhere",
    tracks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("JsonLibraryRepository", () => {
  let libraryDir: string;

  beforeEach(async () => {
    libraryDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-repo-test-"));
  });

  afterEach(async () => {
    await fs.rm(libraryDir, { recursive: true, force: true });
  });

  it("finds a release after upserting it", async () => {
    const repo = new JsonLibraryRepository();
    const release = makeRelease();
    await repo.upsert(libraryDir, release);
    const found = await repo.find(libraryDir, release.id);
    expect(found).toEqual(release);
  });

  it("returns the removed release, and null for a missing id", async () => {
    const repo = new JsonLibraryRepository();
    const release = makeRelease();
    await repo.upsert(libraryDir, release);

    const removed = await repo.remove(libraryDir, release.id);
    expect(removed).toEqual(release);

    const again = await repo.remove(libraryDir, release.id);
    expect(again).toBeNull();

    expect(await repo.find(libraryDir, release.id)).toBeNull();
  });

  it("persists all writes from 20 concurrent upserts", async () => {
    const repo = new JsonLibraryRepository();
    const releases = Array.from({ length: 20 }, (_, i) => makeRelease({ title: `Release ${i}` }));

    await Promise.all(releases.map((r) => repo.upsert(libraryDir, r)));

    const stored = await repo.list(libraryDir);
    expect(stored).toHaveLength(20);
    const ids = new Set(stored.map((r) => r.id));
    for (const r of releases) {
      expect(ids.has(r.id)).toBe(true);
    }
  });

  it("recovers from a corrupt library.json by moving it aside and starting empty", async () => {
    const repo = new JsonLibraryRepository();
    const file = libraryFilePath(libraryDir);
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(file, "{ this is not valid json", "utf-8");

    const stored = await repo.list(libraryDir);
    expect(stored).toEqual([]);

    // The corrupt file was moved aside, not deleted, and a fresh valid one written in its place.
    const dirEntries = await fs.readdir(libraryDir);
    const corruptEntries = dirEntries.filter((name) => name.includes(".corrupt-"));
    expect(corruptEntries).toHaveLength(1);
    const movedContent = await fs.readFile(path.join(libraryDir, corruptEntries[0]), "utf-8");
    expect(movedContent).toBe("{ this is not valid json");

    const freshContent = JSON.parse(await fs.readFile(file, "utf-8"));
    expect(freshContent.releases).toEqual([]);
  });

  it("drops a malformed release entry from list()/find() but keeps it on disk", async () => {
    const repo = new JsonLibraryRepository();
    const good = makeRelease();
    const file = libraryFilePath(libraryDir);
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, releases: [good, { id: "bad", title: "missing fields" }] }, null, 2),
      "utf-8"
    );

    const stored = await repo.list(libraryDir);
    expect(stored).toEqual([good]);
    expect(await repo.find(libraryDir, "bad")).toBeNull();

    // upsert on the (unrelated) good release must not drop the malformed entry from the file.
    await repo.upsert(libraryDir, { ...good, title: "Updated" });
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    expect(raw.releases).toHaveLength(2);
    expect(raw.releases.some((r: { id: string }) => r.id === "bad")).toBe(true);
  });
});
