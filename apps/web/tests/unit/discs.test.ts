import { describe, expect, it } from "vitest";
import { deriveTagNumbers, discHeadings, isDiscNumber, orderByDisc } from "../../src/shared/discs";

describe("deriveTagNumbers", () => {
  it("numbers each track within its disc: discs [1,1,1,2,2] give 1/3 2/3 3/3 1/2 2/2", () => {
    const tracks = [1, 1, 1, 2, 2].map((discNumber, i) => ({ trackNumber: i + 1, discNumber }));
    const tags = deriveTagNumbers(tracks);
    expect(tags.map((t) => `${t.trackNumber}/${t.trackTotal}`)).toEqual(["1/3", "2/3", "3/3", "1/2", "2/2"]);
    expect(tags.map((t) => `${t.discNumber}/${t.discTotal}`)).toEqual(["1/2", "1/2", "1/2", "2/2", "2/2"]);
  });

  it("with no discs, keeps trackNumber over the release count and sets no disc", () => {
    const tags = deriveTagNumbers([{ trackNumber: 1 }, { trackNumber: 2 }, { trackNumber: 4 }]);
    expect(tags).toEqual([
      { trackNumber: 1, trackTotal: 3 },
      { trackNumber: 2, trackTotal: 3 },
      { trackNumber: 4, trackTotal: 3 },
    ]);
    for (const t of tags) expect("discNumber" in t || "discTotal" in t).toBe(false);
  });

  it("orders by trackNumber within a disc whatever order the tracks are given in", () => {
    const tags = deriveTagNumbers([
      { trackNumber: 4, discNumber: 2 },
      { trackNumber: 2, discNumber: 1 },
      { trackNumber: 3, discNumber: 2 },
      { trackNumber: 1, discNumber: 1 },
    ]);
    expect(tags.map((t) => `${t.discNumber}:${t.trackNumber}/${t.trackTotal}`)).toEqual([
      "2:2/2",
      "1:2/2",
      "2:1/2",
      "1:1/2",
    ]);
  });

  it("takes the highest disc number as the disc total, and counts a track with no disc as disc 1", () => {
    const tags = deriveTagNumbers([
      { trackNumber: 1 },
      { trackNumber: 2, discNumber: 1 },
      { trackNumber: 3, discNumber: 3 },
    ]);
    expect(tags.map((t) => t.discTotal)).toEqual([3, 3, 3]);
    expect(tags.map((t) => `${t.discNumber}:${t.trackNumber}/${t.trackTotal}`)).toEqual(["1:1/2", "1:2/2", "3:1/1"]);
  });

  it("does not change the tracks it is given", () => {
    const tracks = [{ trackNumber: 2, discNumber: 2 }, { trackNumber: 1, discNumber: 1 }];
    const copy = structuredClone(tracks);
    deriveTagNumbers(tracks);
    expect(tracks).toEqual(copy);
  });
});

describe("discHeadings", () => {
  it("puts a heading above the first row of each disc", () => {
    expect(discHeadings([1, 1, 1, 2, 2])).toEqual([1, null, null, 2, null]);
  });

  it("shows no headings for one disc, none, or a disc that is not 1", () => {
    expect(discHeadings([1, 1, 1])).toEqual([null, null, null]);
    expect(discHeadings([undefined, undefined])).toEqual([null, null]);
    expect(discHeadings([2, 2])).toEqual([null, null]);
    expect(discHeadings([])).toEqual([]);
  });

  it("counts a row with no disc as disc 1 and repeats a heading when the discs interleave", () => {
    expect(discHeadings([undefined, 2, 1])).toEqual([1, 2, 1]);
  });
});

describe("orderByDisc", () => {
  it("orders by disc, then the file's own track number, keeping ties in input order", () => {
    const files = [
      { name: "d2t1", discNumber: 2, tagTrackNumber: 1 },
      { name: "d1t2", discNumber: 1, tagTrackNumber: 2 },
      { name: "d1t1", discNumber: 1, tagTrackNumber: 1 },
      { name: "d2t2", discNumber: 2, tagTrackNumber: 2 },
    ];
    expect(orderByDisc(files).map((f) => f.name)).toEqual(["d1t1", "d1t2", "d2t1", "d2t2"]);
  });

  it("puts files without a track tag after the numbered files of their disc, in input order", () => {
    const files = [
      { name: "a", discNumber: 1 },
      { name: "b", discNumber: 1, tagTrackNumber: 1 },
      { name: "c", discNumber: 1 },
    ];
    expect(orderByDisc(files).map((f) => f.name)).toEqual(["b", "a", "c"]);
  });

  it("leaves the order alone when no file has a disc tag, even if track tags disagree", () => {
    const files = [
      { name: "x", tagTrackNumber: 2 },
      { name: "y", tagTrackNumber: 1 },
    ];
    expect(orderByDisc(files).map((f) => f.name)).toEqual(["x", "y"]);
  });
});

describe("isDiscNumber", () => {
  it("accepts integers 1 to 99 only", () => {
    expect([1, 2, 99].every(isDiscNumber)).toBe(true);
    expect([0, 100, 1.5, -1, NaN, null, undefined, "1"].some(isDiscNumber)).toBe(false);
  });
});
