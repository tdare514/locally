import { describe, expect, it } from "vitest";
import { aggregatePlays, medalFor, periodHeading, releaseCountLabel } from "../../src/lib/play-stats";
import type { PlayTotal, Release, Track } from "../../src/shared/types";

function track(id: string, title: string, trackNumber = 1): Track {
  return { id, title, trackNumber, filePath: `/lib/${id}.mp3`, originalName: `${id}.mp3`, durationSec: 180 };
}

function release(id: string, artist: string, title: string, tracks: Track[], extra: Partial<Release> = {}): Release {
  return {
    id,
    kind: tracks.length > 1 ? "album" : "single",
    title,
    artist,
    year: null,
    genre: null,
    coverPath: `/lib/${id}/cover.jpg`,
    folderPath: `/lib/${id}`,
    tracks,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    ...extra,
  };
}

/** This Mac's counts for some of a release's tracks, as GET /api/plays/totals lists them. */
function plays(releaseId: string, counts: Record<string, number>): PlayTotal[] {
  return Object.entries(counts).map(([trackId, total]) => ({ releaseId, trackId, total }));
}

describe("aggregatePlays", () => {
  const sea = release("r-sea", "Okoro", "Saltwater Hymns", [track("t1", "Tide", 1), track("t2", "Hymn", 2)]);
  const lantern = release("r-lan", "Quiet Orchard", "Paper Lanterns", [track("t3", "Lanterns")]);
  const bus = release("r-bus", "Okoro", "Night Bus", [track("t4", "Night Bus")], { coverPath: null });

  const counts: PlayTotal[] = [
    ...plays("r-sea", { t1: 5, t2: 2 }),
    ...plays("r-lan", { t3: 6 }),
    ...plays("r-bus", { t4: 4 }),
  ];

  it("ranks tracks, albums and artists, most played first", () => {
    const stats = aggregatePlays([sea, lantern, bus], counts);
    expect(stats.total).toBe(17);
    expect(stats.tracks.map((i) => [i.title, i.plays, i.rank])).toEqual([
      ["Lanterns", 6, 1],
      ["Tide", 5, 2],
      ["Night Bus", 4, 3],
    ]);
    // An album is a release: its tracks' plays added together, singles included.
    expect(stats.albums.map((i) => [i.title, i.plays])).toEqual([
      ["Saltwater Hymns", 7],
      ["Paper Lanterns", 6],
      ["Night Bus", 4],
    ]);
    // An artist is every release they made.
    expect(stats.artists.map((i) => [i.title, i.plays])).toEqual([
      ["Okoro", 11],
      ["Quiet Orchard", 6],
    ]);
  });

  it("subtitles tracks and albums with the artist", () => {
    const stats = aggregatePlays([sea, lantern, bus], counts);
    expect(stats.tracks[0].subtitle).toBe("Quiet Orchard");
    expect(stats.albums[0].subtitle).toBe("Okoro");
  });

  it("subtitles an artist with the genre of their most played release, else the release count", () => {
    const withGenre = release("r-sea", "Okoro", "Saltwater Hymns", sea.tracks, { genre: "Soul" });
    expect(aggregatePlays([withGenre, lantern, bus], counts).artists[0].subtitle).toBe("Soul");
    expect(aggregatePlays([sea, lantern, bus], counts).artists[0].subtitle).toBe("2 releases");
    expect(aggregatePlays([sea, lantern, bus], counts).artists[1].subtitle).toBe("1 release");
  });

  it("limits each list to three", () => {
    const many = ["a", "b", "c", "d", "e"].map((x) => release(`r-${x}`, `Artist ${x}`, `Album ${x}`, [track(`t-${x}`, `Song ${x}`)]));
    const byRelease = many.flatMap((r, i) => plays(r.id, { [r.tracks[0].id]: 10 - i }));
    const stats = aggregatePlays(many, byRelease);
    expect(stats.tracks).toHaveLength(3);
    expect(stats.albums).toHaveLength(3);
    expect(stats.artists).toHaveLength(3);
    expect(stats.tracks.map((i) => i.plays)).toEqual([10, 9, 8]);
    expect(aggregatePlays(many, byRelease, 5).tracks).toHaveLength(5);
  });

  it("orders equal plays A to Z by title, then by id, and never repeats a rank", () => {
    const rel = release("r-1", "Artist", "Album", [track("t-z", "Zebra", 1), track("t-a", "apple", 2), track("t-m", "Mango", 3)]);
    const stats = aggregatePlays([rel], plays("r-1", { "t-z": 3, "t-a": 3, "t-m": 3 }));
    expect(stats.tracks.map((i) => [i.title, i.rank])).toEqual([
      ["apple", 1],
      ["Mango", 2],
      ["Zebra", 3],
    ]);

    const twin1 = release("r-b", "Same", "Twin", [track("t-b", "Song b")]);
    const twin2 = release("r-a", "Same", "Twin", [track("t-a", "Song a")]);
    const albums = aggregatePlays([twin1, twin2], [...plays("r-a", { "t-a": 2 }), ...plays("r-b", { "t-b": 2 })]).albums;
    expect(albums.map((i) => i.id)).toEqual(["r-a", "r-b"]);
  });

  it("is empty with no plays at all", () => {
    const noPlays: PlayTotal[][] = [[], plays("r-sea", { t1: 0, t2: 0 })];
    for (const byRelease of noPlays) {
      const stats = aggregatePlays([sea, lantern, bus], byRelease);
      expect(stats).toEqual({ total: 0, tracks: [], albums: [], artists: [] });
    }
    expect(aggregatePlays([], counts).total).toBe(0);
  });

  it("leaves out releases and tracks with no plays", () => {
    const stats = aggregatePlays([sea, lantern, bus], plays("r-sea", { t1: 3 }));
    expect(stats.tracks.map((i) => i.title)).toEqual(["Tide"]);
    expect(stats.albums.map((i) => i.title)).toEqual(["Saltwater Hymns"]);
    expect(stats.artists.map((i) => i.title)).toEqual(["Okoro"]);
  });

  it("ignores counts for tracks that are no longer in the release or the library", () => {
    const stats = aggregatePlays([sea], [
      ...plays("r-sea", { t1: 2, "t-gone": 50 }),
      ...plays("r-deleted", { x: 99 }),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.tracks.map((i) => i.title)).toEqual(["Tide"]);
  });

  it("only counts a track under the release it was counted for", () => {
    // t1 belongs to r-sea; a count that names another release for it is not that track's.
    const stats = aggregatePlays([sea, lantern], plays("r-lan", { t1: 9 }));
    expect(stats.total).toBe(0);
  });

  it("ignores counts that are not positive numbers", () => {
    const stats = aggregatePlays([sea], plays("r-sea", { t1: -3, t2: Number.NaN }));
    expect(stats.total).toBe(0);
  });

  it("treats one artist written two ways as one", () => {
    const a = release("r-1", "Mira Valdane", "One", [track("t-1", "One")]);
    const b = release("r-2", "  mira valdane ", "Two", [track("t-2", "Two")]);
    const stats = aggregatePlays([a, b], [...plays("r-1", { "t-1": 2 }), ...plays("r-2", { "t-2": 3 })]);
    expect(stats.artists).toHaveLength(1);
    expect(stats.artists[0]).toMatchObject({ title: "Mira Valdane", plays: 5, subtitle: "2 releases" });
  });

  it("leaves a blank artist out of the artist list but still counts the plays", () => {
    const nameless = release("r-1", "  ", "Untitled", [track("t-1", "Song")]);
    const stats = aggregatePlays([nameless], plays("r-1", { "t-1": 4 }));
    expect(stats.artists).toEqual([]);
    expect(stats.albums).toHaveLength(1);
    expect(stats.total).toBe(4);
  });

  it("points each item at a cover, and an artist at their most played release's cover", () => {
    const stats = aggregatePlays([sea, lantern, bus], counts);
    expect(stats.tracks[0].cover).toEqual({ releaseId: "r-lan", updatedAt: "2026-02-02T00:00:00.000Z" });
    // Night Bus has no cover.
    expect(stats.albums[2].cover).toBeNull();
    // Okoro's most played release is Saltwater Hymns.
    expect(stats.artists[0].cover?.releaseId).toBe("r-sea");

    // When the most played release has no cover, another played one stands in.
    const coverless = release("r-sea", "Okoro", "Saltwater Hymns", sea.tracks, { coverPath: null });
    expect(aggregatePlays([coverless, lantern, bus], counts).artists[0].cover).toBeNull();
    const withBusCover = release("r-bus", "Okoro", "Night Bus", bus.tracks);
    expect(aggregatePlays([coverless, lantern, withBusCover], counts).artists[0].cover?.releaseId).toBe("r-bus");
  });

  it("falls back to the release title for a track with no title, and to the artist for a release with none", () => {
    const untitledTrack = release("r-1", "Someone", "Album", [track("t-1", "")]);
    expect(aggregatePlays([untitledTrack], plays("r-1", { "t-1": 1 })).tracks[0].title).toBe("Album");
    const untitledRelease = release("r-2", "Someone", "", [track("t-2", "Song")]);
    expect(aggregatePlays([untitledRelease], plays("r-2", { "t-2": 1 })).albums[0].title).toBe("Someone");
  });
});

describe("small labels", () => {
  it("says 1 release and N releases", () => {
    expect(releaseCountLabel(0)).toBe("0 releases");
    expect(releaseCountLabel(1)).toBe("1 release");
    expect(releaseCountLabel(6)).toBe("6 releases");
  });

  it("headings: Your plays while it is all time", () => {
    expect(periodHeading("all")).toBe("Your plays");
    expect(periodHeading("today")).toBe("Your day");
    expect(periodHeading("week")).toBe("Your week");
    expect(periodHeading("month")).toBe("Your month");
  });

  it("gives the first three ranks a medal", () => {
    expect(medalFor(1)).toBe("gold");
    expect(medalFor(2)).toBe("silver");
    expect(medalFor(3)).toBe("bronze");
    expect(medalFor(4)).toBeUndefined();
  });
});
