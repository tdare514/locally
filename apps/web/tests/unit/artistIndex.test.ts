import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildArtistIndex,
  didYouMean,
  didYouMeanButton,
  didYouMeanLine,
  matchRange,
  suggestArtists,
  trackCountLabel,
  type ArtistEntry,
  type DidYouMean,
} from "../../src/lib/artist-index";

const file = fileURLToPath(new URL("../../../../spec/fixtures/artists/index.json", import.meta.url));

interface Case {
  name: string;
  releases: { artist: string; tracks: string[] }[];
  index?: ArtistEntry[];
  suggest?: { query: string; limit: number; expected: string[] }[];
  didYouMean?: { typed: string; expected: DidYouMean | null }[];
}

const cases = JSON.parse(readFileSync(file, "utf8")) as Case[];

function indexOf(c: Case): ArtistEntry[] {
  return buildArtistIndex(c.releases.map((r) => ({ artist: r.artist, tracks: r.tracks.map((title) => ({ title })) })));
}

describe("artist index fixtures", () => {
  it("has cases", () => expect(cases.length).toBeGreaterThan(0));

  it.each(cases.filter((c) => c.index).map((c) => [c.name, c] as const))("buildArtistIndex: %s", (_n, c) => {
    expect(indexOf(c)).toEqual(c.index);
  });

  it.each(cases.filter((c) => c.suggest).map((c) => [c.name, c] as const))("suggestArtists: %s", (_n, c) => {
    const index = indexOf(c);
    for (const s of c.suggest ?? []) {
      expect(suggestArtists(index, s.query, s.limit).map((e) => e.display), JSON.stringify(s.query)).toEqual(s.expected);
    }
  });

  it.each(cases.filter((c) => c.didYouMean).map((c) => [c.name, c] as const))("didYouMean: %s", (_n, c) => {
    const index = indexOf(c);
    for (const d of c.didYouMean ?? []) {
      expect(didYouMean(index, d.typed), JSON.stringify(d.typed)).toEqual(d.expected);
    }
  });
});

describe("artist suggestion copy", () => {
  it("counts tracks", () => {
    expect(trackCountLabel(1)).toBe("1 track");
    expect(trackCountLabel(12)).toBe("12 tracks");
  });
  it("words the two lines and the button", () => {
    const like: DidYouMean = { kind: "looksLike", artist: "The Weeknd", trackCount: 12 };
    const spelling: DidYouMean = { kind: "spelling", artist: "The Weeknd", trackCount: 12 };
    expect(didYouMeanLine(like)).toBe("You have 12 tracks by The Weeknd.");
    expect(didYouMeanLine(spelling)).toBe("Matches The Weeknd. Use that spelling?");
    expect(didYouMeanButton(like)).toBe("Use The Weeknd");
  });
});

describe("matchRange", () => {
  it("finds the typed letters at a word start, ignoring case and accents", () => {
    expect(matchRange("The Weeknd", "wee")).toEqual({ start: 4, end: 7 });
    expect(matchRange("Beyoncé", "beyonc")).toEqual({ start: 0, end: 6 });
    expect(matchRange("Weezer", "zzz")).toBeNull();
    expect(matchRange("Weezer", "  ")).toBeNull();
  });
});
