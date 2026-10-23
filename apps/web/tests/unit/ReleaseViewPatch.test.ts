import { describe, expect, it } from "vitest";
import { buildPatch, releaseDateBlocked } from "../../src/components/ReleaseView";
import { initialReleaseDateText } from "../../src/lib/release-date-input";
import type { Release } from "../../src/shared/types";

function release(discs: (number | undefined)[]): Release {
  return {
    id: "r1",
    kind: "album",
    title: "Double",
    artist: "A",
    year: null,
    genre: null,
    coverPath: null,
    folderPath: "/lib/A/Double",
    tracks: discs.map((discNumber, i) => ({
      id: `t${i + 1}`,
      title: `T${i + 1}`,
      trackNumber: i + 1,
      ...(discNumber !== undefined ? { discNumber } : {}),
      filePath: `/lib/A/Double/${i + 1}.mp3`,
      originalName: `${i + 1}.mp3`,
      durationSec: null,
    })),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const draftFor = (r: Release, tracks: { key: string; title: string; discNumber?: number }[]) => ({
  title: r.title,
  artist: r.artist,
  releaseDate: initialReleaseDateText(r.year, r.releaseDate),
  genre: "",
  tracks,
});

describe("buildPatch with discs", () => {
  it("is empty when nothing changed, discs included", () => {
    const r = release([1, 1, 2]);
    expect(buildPatch(r, draftFor(r, r.tracks.map((t) => ({ key: t.id, title: t.title, discNumber: t.discNumber }))))).toBeNull();
  });

  it("sends the disc a track joined when it was dropped among another disc's tracks", () => {
    const r = release([1, 1, 2, 2]);
    // t3 (disc 2) dragged to the top and adopted disc 1.
    const dragged = [
      { key: "t3", title: "T3", discNumber: 1 },
      { key: "t1", title: "T1", discNumber: 1 },
      { key: "t2", title: "T2", discNumber: 1 },
      { key: "t4", title: "T4", discNumber: 2 },
    ];
    const patch = buildPatch(r, draftFor(r, dragged));
    expect(patch?.tracks).toEqual([
      { id: "t3", trackNumber: 1, discNumber: 1 },
      { id: "t1", trackNumber: 2 },
      { id: "t2", trackNumber: 3 },
    ]);
  });

  it("sends no discNumber for a release without discs", () => {
    const r = release([undefined, undefined]);
    const patch = buildPatch(r, draftFor(r, [{ key: "t2", title: "T2" }, { key: "t1", title: "T1" }]));
    expect(patch?.tracks).toEqual([
      { id: "t2", trackNumber: 1 },
      { id: "t1", trackNumber: 2 },
    ]);
  });
});

describe("buildPatch with the release date", () => {
  const withDate = (year: string | null, releaseDate?: string): Release => ({
    ...release([undefined]),
    year,
    ...(releaseDate !== undefined ? { releaseDate } : {}),
  });
  const tracksOf = (r: Release) => r.tracks.map((t) => ({ key: t.id, title: t.title }));
  const patchFor = (r: Release, text: string) =>
    buildPatch(r, { ...draftFor(r, tracksOf(r)), releaseDate: text });

  it("sends nothing when the text is untouched, on a date or on none", () => {
    expect(patchFor(withDate(null), "")).toBeNull();
    expect(patchFor(withDate("2024"), initialReleaseDateText("2024", undefined))).toBeNull();
    expect(patchFor(withDate("2024", "2024-05-17"), initialReleaseDateText("2024", "2024-05-17"))).toBeNull();
  });

  it("sends nothing for a date retyped in another form", () => {
    expect(patchFor(withDate("2024", "2024-05-17"), "2024-05-17")).toBeNull();
    expect(patchFor(withDate("2024", "2024-05-17"), "17 May 2024")).toBeNull();
  });

  it("saves a year alone as year only", () => {
    expect(patchFor(withDate(null), "2024")).toEqual({ year: "2024" });
  });

  it("saves a full date on a year-only release as year and releaseDate", () => {
    expect(patchFor(withDate("2024"), "17 May 2024")).toEqual({ year: "2024", releaseDate: "2024-05-17" });
    expect(patchFor(withDate("2024"), "May 2024")).toEqual({ year: "2024", releaseDate: "2024-05" });
  });

  it("shortening to the year sends year without releaseDate", () => {
    expect(patchFor(withDate("2024", "2024-05-17"), "2024")).toEqual({ year: "2024" });
  });

  it("changing the year of a precise date sends both", () => {
    expect(patchFor(withDate("2024", "2024-05-17"), "17 May 2023")).toEqual({ year: "2023", releaseDate: "2023-05-17" });
  });

  it("clearing the text clears the year", () => {
    expect(patchFor(withDate("2024", "2024-05-17"), "")).toEqual({ year: null });
  });

  it("leaves an odd old year alone while its text is untouched", () => {
    const r = withDate("199x");
    expect(initialReleaseDateText("199x", undefined)).toBe("199x");
    expect(patchFor(r, "199x")).toBeNull();
    expect(releaseDateBlocked(r, "199x")).toBe(false);
    // Another edit still saves without touching the date.
    expect(buildPatch(r, { ...draftFor(r, tracksOf(r)), releaseDate: "199x", artist: "B" })).toEqual({ artist: "B" });
  });

  it("an odd old year can be replaced or cleared", () => {
    const r = withDate("199x");
    expect(patchFor(r, "1999")).toEqual({ year: "1999" });
    expect(patchFor(r, "")).toEqual({ year: null });
  });

  it("leaves unreadable or impossible text out of the patch and blocks Save", () => {
    const r = withDate("2024");
    for (const text of ["soon", "31/02/2024", "2024-13"]) {
      expect(patchFor(r, text)).toBeNull();
      expect(releaseDateBlocked(r, text)).toBe(true);
    }
    expect(releaseDateBlocked(r, "")).toBe(false);
    expect(releaseDateBlocked(r, "2023")).toBe(false);
  });
});
