import { describe, expect, it } from "vitest";
import type { Release, Track } from "../../src/shared/types";
import {
  artistCountLine,
  artistPageLine,
  buildArtistCatalog,
  catalogEntry,
  creditKey,
  filterArtists,
  groupByLetter,
  mostPlayed,
} from "../../src/lib/artist-catalog";

let nextId = 0;
function track(title: string, trackNumber = 1): Track {
  nextId += 1;
  return { id: `t${nextId}`, title, trackNumber, filePath: "/x.mp3", originalName: "x.mp3", durationSec: 100 };
}

function release(over: Partial<Release> & { artist: string; titles?: string[] }): Release {
  nextId += 1;
  const { titles, ...rest } = over;
  return {
    id: `r${nextId}`,
    kind: "single",
    title: "Title",
    year: "2024",
    genre: null,
    coverPath: "/cover.jpg",
    folderPath: "/f",
    tracks: (titles ?? ["Song"]).map((t, i) => track(t, i + 1)),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...rest,
  };
}

describe("buildArtistCatalog", () => {
  it("groups case and accent variants under one key, showing the most used spelling", () => {
    const catalog = buildArtistCatalog([
      release({ artist: "Beyonce", titles: ["a"] }),
      release({ artist: "Beyoncé", kind: "album", titles: ["a", "b", "c"] }),
      release({ artist: "BEYONCE", titles: ["a"] }),
    ]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe("Beyoncé");
    expect(catalog[0].albums).toHaveLength(1);
    expect(catalog[0].singles).toHaveLength(2);
  });

  it("gives an adopted 'A feat. B' release to A, with B under appears on", () => {
    const r = release({ artist: "Alpha feat. Beta", titles: ["One", "Two"] });
    const catalog = buildArtistCatalog([r]);
    expect(catalog.map((e) => e.name)).toEqual(["Alpha", "Beta"]);
    const beta = catalogEntry(catalog, "beta");
    expect(beta?.releaseCount).toBe(0);
    expect(beta?.appearsOn.map((a) => a.track.title)).toEqual(["One", "Two"]);
    expect(catalogEntry(catalog, "alpha")?.appearsOn).toEqual([]);
  });

  it("keeps an ampersand duo as one artist", () => {
    const catalog = buildArtistCatalog([release({ artist: "Hall & Oates" })]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe("Hall & Oates");
  });

  it("splits albums from singles", () => {
    const album = release({ artist: "A", kind: "album" });
    const single = release({ artist: "A", kind: "single" });
    const entry = buildArtistCatalog([album, single])[0];
    expect(entry.albums).toEqual([album]);
    expect(entry.singles).toEqual([single]);
    expect(entry.releaseCount).toBe(2);
    expect(entry.trackCount).toBe(2);
  });

  it("makes a featured-only artist an entry, excluding their own releases from appears on", () => {
    const theirs = release({ artist: "Guest", titles: ["Mine (feat. Host)"] });
    const hosted = release({ artist: "Host", titles: ["Duet (feat. Guest)"] });
    const catalog = buildArtistCatalog([theirs, hosted]);
    const guest = catalogEntry(catalog, "guest");
    expect(guest?.appearsOn.map((a) => a.release.id)).toEqual([hosted.id]);
    const only = buildArtistCatalog([hosted]);
    const featuredOnly = catalogEntry(only, "guest");
    expect(featuredOnly?.releaseCount).toBe(0);
    expect(featuredOnly?.trackCount).toBe(0);
    expect(featuredOnly?.newest?.id).toBe(hosted.id);
    expect(featuredOnly?.covers).toEqual([{ releaseId: hosted.id, updatedAt: hosted.updatedAt }]);
    expect(catalogEntry(only, "nobody")).toBeNull();
  });

  it("orders newest first, a missing year last, then by date added", () => {
    const old = release({ artist: "A", year: "2019" });
    const none = release({ artist: "A", year: null });
    const recent = release({ artist: "A", year: "2024", createdAt: "2024-02-01T00:00:00.000Z" });
    const sameYearEarlier = release({ artist: "A", year: "2024", createdAt: "2024-01-01T00:00:00.000Z" });
    const entry = buildArtistCatalog([old, none, sameYearEarlier, recent])[0];
    expect(entry.singles.map((r) => r.id)).toEqual([recent.id, sameYearEarlier.id, old.id, none.id]);
    expect(entry.newest?.id).toBe(recent.id);
    expect(entry.covers.map((c) => c.releaseId)).toEqual([recent.id, sameYearEarlier.id, old.id]);
  });

  it("sorts A to Z ignoring a leading The, with # last", () => {
    const catalog = buildArtistCatalog(
      ["Zed", "The Weeknd", "Alpha", "808 State", "Beta"].map((artist) => release({ artist })),
    );
    expect(catalog.map((e) => e.name)).toEqual(["808 State", "Alpha", "Beta", "The Weeknd", "Zed"]);
    expect(groupByLetter(catalog).map((g) => g.letter)).toEqual(["A", "B", "W", "Z", "#"]);
    expect(groupByLetter(catalog).at(-1)?.entries.map((e) => e.name)).toEqual(["808 State"]);
  });
});

describe("mostPlayed", () => {
  it("ranks the top five by plays, drops zero plays, breaks ties by title", () => {
    const album = release({
      artist: "A",
      kind: "album",
      titles: ["Delta", "Bravo", "Alpha", "Charlie", "Echo", "Foxtrot", "Never"],
    });
    const other = release({ artist: "B", titles: ["Guest (feat. A)"] });
    const entry = buildArtistCatalog([album, other]).find((e) => e.key === "a");
    expect(entry).toBeDefined();
    const plays = new Map<string, number>([
      [album.tracks[0].id, 5],
      [album.tracks[1].id, 5],
      [album.tracks[2].id, 9],
      [album.tracks[3].id, 1],
      [album.tracks[4].id, 2],
      [album.tracks[5].id, 3],
      [other.tracks[0].id, 4],
    ]);
    const top = mostPlayed(entry!, plays);
    expect(top.map((r) => r.track.title)).toEqual(["Alpha", "Bravo", "Delta", "Guest (feat. A)", "Foxtrot"]);
    expect(top.map((r) => r.plays)).toEqual([9, 5, 5, 4, 3]);
    expect(mostPlayed(entry!, new Map())).toEqual([]);
  });
});

describe("counts and search", () => {
  it("words the count lines", () => {
    const a = buildArtistCatalog([release({ artist: "A", kind: "album", titles: ["x"] })])[0];
    expect(artistCountLine(a)).toBe("1 release, 1 track");
    expect(artistPageLine(a)).toBe("1 album");
    const catalog = buildArtistCatalog([
      release({ artist: "A", kind: "album", titles: ["x", "y"] }),
      release({ artist: "A" }),
      release({ artist: "A" }),
      release({ artist: "B", titles: ["s (feat. A)"] }),
    ]);
    const entry = catalogEntry(catalog, "a")!;
    expect(artistCountLine(entry)).toBe("3 releases, 4 tracks");
    expect(artistPageLine(entry)).toBe("1 album, 2 singles, appears on 1 track");
    const guest = buildArtistCatalog([release({ artist: "B", titles: ["s (feat. G)", "t (feat. G)"] })]);
    expect(artistCountLine(catalogEntry(guest, "g")!)).toBe("Appears on 2 tracks");
    expect(artistPageLine(catalogEntry(guest, "g")!)).toBe("Appears on 2 tracks");
  });

  it("filters by name, folding case and accents", () => {
    const catalog = buildArtistCatalog([release({ artist: "Björk" }), release({ artist: "Beck" })]);
    expect(filterArtists(catalog, "BJORK").map((e) => e.name)).toEqual(["Björk"]);
    expect(filterArtists(catalog, "  ")).toBe(catalog);
    expect(filterArtists(catalog, "zzz")).toEqual([]);
  });
});

describe("creditKey", () => {
  it("opens the main artist of a credit", () => {
    expect(creditKey("Alpha feat. Beta")).toBe("alpha");
    expect(creditKey("Alpha")).toBe("alpha");
    expect(creditKey("Hall & Oates")).toBe("hall and oates");
  });
});
