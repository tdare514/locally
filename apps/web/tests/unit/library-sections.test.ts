import { describe, expect, it } from "vitest";
import {
  libraryRowSubtitle,
  partitionLibrary,
  sortByNewest,
} from "../../src/lib/library-sections";
import type { Release, Track } from "../../src/shared/types";

function track(id: string, title: string): Track {
  return {
    id,
    title,
    trackNumber: 1,
    filePath: `/lib/${id}.mp3`,
    originalName: `${title}.mp3`,
    durationSec: 180,
  };
}

function release(
  partial: Pick<Release, "id" | "kind" | "title" | "artist" | "updatedAt"> & {
    tracks?: Track[];
    createdAt?: string;
  }
): Release {
  return {
    year: null,
    genre: null,
    coverPath: null,
    folderPath: `/lib/${partial.id}`,
    createdAt: partial.createdAt ?? partial.updatedAt,
    tracks: partial.tracks ?? [track(`${partial.id}-t1`, partial.title)],
    ...partial,
  };
}

describe("sortByNewest", () => {
  it("orders by updatedAt descending", () => {
    const a = release({
      id: "a",
      kind: "single",
      title: "Old",
      artist: "A",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const b = release({
      id: "b",
      kind: "single",
      title: "New",
      artist: "B",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(sortByNewest([a, b]).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("partitionLibrary", () => {
  it("splits singles and albums, hides nothing by returning empty arrays", () => {
    const single = release({
      id: "s1",
      kind: "single",
      title: "One",
      artist: "Solo",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    const album = release({
      id: "a1",
      kind: "album",
      title: "Two",
      artist: "Band",
      updatedAt: "2026-04-01T00:00:00.000Z",
      tracks: [track("a1-t1", "A"), track("a1-t2", "B")],
    });
    const olderSingle = release({
      id: "s0",
      kind: "single",
      title: "Zero",
      artist: "Solo",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const sections = partitionLibrary([single, album, olderSingle]);
    expect(sections.singles.map((r) => r.id)).toEqual(["s1", "s0"]);
    expect(sections.albums.map((r) => r.id)).toEqual(["a1"]);
    expect(sections.totalTracks).toBe(4);
  });

  it("returns empty sections when the library is empty", () => {
    expect(partitionLibrary([])).toEqual({
      singles: [],
      albums: [],
      totalTracks: 0,
    });
  });
});

describe("libraryRowSubtitle", () => {
  it("keeps the artist for singles", () => {
    const r = release({
      id: "s",
      kind: "single",
      title: "Hit",
      artist: "Artist",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(libraryRowSubtitle(r)).toBe("Artist");
  });

  it("adds a track count for albums", () => {
    const r = release({
      id: "a",
      kind: "album",
      title: "LP",
      artist: "Band",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tracks: [track("1", "A"), track("2", "B"), track("3", "C")],
    });
    expect(libraryRowSubtitle(r)).toBe("Band · 3 tracks");
  });
});
