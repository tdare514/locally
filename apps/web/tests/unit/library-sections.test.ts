import { describe, expect, it } from "vitest";
import {
  filterLibrary,
  libraryRowSubtitle,
  normalizeSearchText,
  partitionLibrary,
  sortByNewest,
  sortLibrary,
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

  it("honours the sort argument within each section", () => {
    const a = simple("a", "Alpha", "X", { updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = simple("b", "Beta", "X", { updatedAt: "2026-06-01T00:00:00.000Z" });
    const album = simple("c", "Gamma", "X", { kind: "album" });
    expect(partitionLibrary([a, b, album]).singles.map((r) => r.id)).toEqual(["b", "a"]);
    const byTitle = partitionLibrary([b, a, album], "title");
    expect(byTitle.singles.map((r) => r.id)).toEqual(["a", "b"]);
    expect(byTitle.albums.map((r) => r.id)).toEqual(["c"]);
    expect(byTitle.totalTracks).toBe(3);
  });

  it("returns empty sections when the library is empty", () => {
    expect(partitionLibrary([])).toEqual({
      singles: [],
      albums: [],
      totalTracks: 0,
    });
  });
});

function simple(
  id: string,
  title: string,
  artist: string,
  extra: Partial<Release> = {}
): Release {
  return {
    ...release({
      id,
      kind: "single",
      title,
      artist,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    ...extra,
  };
}

describe("normalizeSearchText", () => {
  it("lowercases, strips diacritics, and collapses whitespace", () => {
    expect(normalizeSearchText("  Björk   HOMOGENIC \n")).toBe("bjork homogenic");
    expect(normalizeSearchText("Beyoncé")).toBe("beyonce");
  });
});

describe("filterLibrary", () => {
  const releases = [
    simple("1", "Homogenic", "Björk", { genre: "Electronic", year: "1997" }),
    simple("2", "Blue Lines", "Massive Attack", {
      genre: "Trip Hop",
      year: "1991",
      tracks: [track("2-t1", "Unfinished Sympathy")],
    }),
    simple("3", "Other", "Someone", { year: null, genre: null }),
  ];

  it("returns the same array for an empty or blank query", () => {
    expect(filterLibrary(releases, "")).toBe(releases);
    expect(filterLibrary(releases, "   ")).toBe(releases);
  });

  it("matches title, artist, genre, year, and track titles", () => {
    expect(filterLibrary(releases, "homogenic").map((r) => r.id)).toEqual(["1"]);
    expect(filterLibrary(releases, "BJORK").map((r) => r.id)).toEqual(["1"]);
    expect(filterLibrary(releases, "trip hop").map((r) => r.id)).toEqual(["2"]);
    expect(filterLibrary(releases, "1991").map((r) => r.id)).toEqual(["2"]);
    expect(filterLibrary(releases, "sympathy").map((r) => r.id)).toEqual(["2"]);
  });

  it("requires every token to match", () => {
    expect(filterLibrary(releases, "massive sympathy").map((r) => r.id)).toEqual(["2"]);
    expect(filterLibrary(releases, "massive homogenic")).toEqual([]);
  });

  it("returns an empty array when nothing matches and keeps input order", () => {
    expect(filterLibrary(releases, "zzz")).toEqual([]);
    expect(filterLibrary(releases, "e").map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("sortLibrary", () => {
  it("newest orders by updatedAt descending", () => {
    const a = simple("a", "A", "X", { updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = simple("b", "B", "X", { updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(sortLibrary([a, b], "newest").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("title sorts naturally, ignoring case, with artist then recency as ties", () => {
    const list = [
      simple("10", "Track 10", "A"),
      simple("2", "Track 2", "A"),
      simple("b", "banana", "Z"),
      simple("t1", "Same", "B", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      simple("t2", "Same", "A", { updatedAt: "2026-01-01T00:00:00.000Z" }),
      simple("t3", "Same", "A", { updatedAt: "2026-05-01T00:00:00.000Z" }),
    ];
    expect(sortLibrary(list, "title").map((r) => r.id)).toEqual([
      "b",
      "t3",
      "t2",
      "t1",
      "2",
      "10",
    ]);
  });

  it("artist sorts by artist, then title, then recency", () => {
    const list = [
      simple("1", "B side", "Zed"),
      simple("2", "Z side", "abba"),
      simple("3", "A side", "abba"),
    ];
    expect(sortLibrary(list, "artist").map((r) => r.id)).toEqual(["3", "2", "1"]);
  });

  it("year puts newest years first and releases without a year last", () => {
    const list = [
      simple("none-b", "B", "X", { year: null }),
      simple("old", "Old", "X", { year: "1991" }),
      simple("none-a", "A", "X", { year: null }),
      simple("new", "New", "X", { year: "2024" }),
      simple("new-a", "Aardvark", "X", { year: "2024" }),
    ];
    expect(sortLibrary(list, "year").map((r) => r.id)).toEqual([
      "new-a",
      "new",
      "old",
      "none-a",
      "none-b",
    ]);
  });

  it("does not mutate its input", () => {
    const list = [simple("b", "B", "X"), simple("a", "A", "X")];
    const snapshot = [...list];
    const sorted = sortLibrary(list, "title");
    expect(list).toEqual(snapshot);
    expect(sorted).not.toBe(list);
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
