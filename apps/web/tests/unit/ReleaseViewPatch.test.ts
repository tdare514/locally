import { describe, expect, it } from "vitest";
import { buildPatch } from "../../src/components/ReleaseView";
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
  year: "",
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
