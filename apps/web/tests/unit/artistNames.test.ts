import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  artistKey,
  joinFeaturing,
  looksLike,
  splitArtistFeaturing,
  splitFeaturing,
} from "../../src/lib/artist-names";

const fixturesDir = fileURLToPath(new URL("../../../../spec/fixtures/artists/", import.meta.url));
const files = ["keys", "looks-like", "title-split", "title-join", "artist-split"];

function load<T>(file: string): (T & { name: string })[] {
  return JSON.parse(readFileSync(`${fixturesDir}${file}.json`, "utf8")) as (T & { name: string })[];
}

const keys = load<{ inputs: string[]; key: string }>("keys");
const looks = load<{ a: string; b: string; expected: boolean }>("looks-like");
const splits = load<{ input: string; title: string; featuring: string[] }>("title-split");
const joins = load<{ title: string; featuring: string[]; expected: string }>("title-join");
const artistSplits = load<{ input: string; artist: string; featuring: string[] }>("artist-split");

describe("artist name fixtures", () => {
  it("has a non-empty file for every category", () => {
    for (const file of files) {
      expect(load(file).length, `${file}.json is empty`).toBeGreaterThan(0);
    }
  });

  it.each(keys.map((c) => [c.name, c] as const))("artistKey: %s", (_name, c) => {
    for (const input of c.inputs) expect(artistKey(input), input).toBe(c.key);
  });

  it.each(looks.map((c) => [c.name, c] as const))("looksLike: %s", (_name, c) => {
    expect(looksLike(c.a, c.b)).toBe(c.expected);
    expect(looksLike(c.b, c.a)).toBe(c.expected);
  });

  it.each(splits.map((c) => [c.name, c] as const))("splitFeaturing: %s", (_name, c) => {
    expect(splitFeaturing(c.input)).toEqual({ title: c.title, featuring: c.featuring });
  });

  it.each(joins.map((c) => [c.name, c] as const))("joinFeaturing: %s", (_name, c) => {
    expect(joinFeaturing(c.title, c.featuring)).toBe(c.expected);
    const split = splitFeaturing(c.expected);
    expect(joinFeaturing(split.title, split.featuring)).toBe(c.expected);
  });

  it.each(artistSplits.map((c) => [c.name, c] as const))("splitArtistFeaturing: %s", (_name, c) => {
    expect(splitArtistFeaturing(c.input)).toEqual({ artist: c.artist, featuring: c.featuring });
  });
});
