import { describe, expect, it } from "vitest";
import { moveItem } from "../../src/lib/track-order";
import {
  adoptDiscAfterMove,
  deriveTagNumbers,
  discActionsFor,
  discHeadings,
  isDiscNumber,
  joinPreviousDisc,
  orderByDisc,
  startDiscAt,
} from "../../src/shared/discs";

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

describe("adoptDiscAfterMove", () => {
  interface Row {
    key: string;
    discNumber?: number;
  }
  const rows = (discs: (number | undefined)[]): Row[] =>
    discs.map((discNumber, i) => ({ key: `t${i + 1}`, ...(discNumber !== undefined ? { discNumber } : {}) }));
  const discsOf = (list: Row[]) => list.map((r) => r.discNumber);
  /** What TrackList does on a drop or a keyboard step. */
  const move = (list: Row[], from: number, to: number) => {
    const moved = moveItem(list, from, to);
    return moved === list ? list : adoptDiscAfterMove(moved, to);
  };

  it("a disc-2 track moved to the top takes disc 1 from the track below it", () => {
    const after = move(rows([1, 1, 2, 2]), 2, 0);
    expect(after.map((r) => r.key)).toEqual(["t3", "t1", "t2", "t4"]);
    expect(discsOf(after)).toEqual([1, 1, 1, 2]);
    expect(discHeadings(discsOf(after))).toEqual([1, null, null, 2]);
  });

  it("then the last disc-1 track moved below the Disc 2 heading takes disc 2", () => {
    const first = move(rows([1, 1, 2, 2]), 2, 0); // discs [1,1,1,2]
    const after = move(first, 2, 3); // t2 now sits under the Disc 2 track
    expect(after.map((r) => r.key)).toEqual(["t3", "t1", "t4", "t2"]);
    expect(discsOf(after)).toEqual([1, 1, 2, 2]);
    expect(discHeadings(discsOf(after))).toEqual([1, null, 2, null]);
  });

  it("a track dropped between two tracks of its own disc stays put, and one dropped at a boundary joins the disc above", () => {
    expect(discsOf(move(rows([1, 1, 2, 2]), 0, 1))).toEqual([1, 1, 2, 2]);
    // Disc 2's first track moved up one place sits under disc 1's first track.
    expect(discsOf(move(rows([1, 1, 2, 2]), 2, 1))).toEqual([1, 1, 1, 2]);
    // Disc 1's last track moved down one place sits under disc 2's first track.
    expect(discsOf(move(rows([1, 1, 2, 2]), 1, 2))).toEqual([1, 2, 2, 2]);
  });

  it("takes the disc of the track below when the moved track is now first", () => {
    expect(discsOf(move(rows([1, 2, 3]), 2, 0))).toEqual([1, 1, 2]);
  });

  it("never repeats a heading, whatever sequence of moves is made", () => {
    let list = rows([1, 1, 2, 2, 3]);
    for (const [from, to] of [[4, 0], [0, 3], [2, 4], [3, 1], [1, 0], [4, 2]]) {
      list = move(list, from, to);
      const headings = discHeadings(discsOf(list)).filter((h) => h !== null);
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  it("leaves a release without discs alone: no discNumber appears", () => {
    const after = move(rows([undefined, undefined, undefined]), 2, 0);
    expect(after.map((r) => r.key)).toEqual(["t3", "t1", "t2"]);
    for (const r of after) expect(r).not.toHaveProperty("discNumber");
  });

  it("counts a neighbour with no disc as disc 1 once the release has discs", () => {
    // The track above has no disc, so the moved track joins disc 1.
    expect(discsOf(move(rows([undefined, 2, 2]), 2, 1))).toEqual([undefined, 1, 2]);
    // A drop that changes nothing is not a move, so nothing is adopted.
    expect(discsOf(move(rows([undefined, 2, 2]), 1, 1))).toEqual([undefined, 2, 2]);
  });

  it("does not change its input or the tracks that did not move", () => {
    const list = rows([1, 2]);
    const moved = moveItem(list, 1, 0);
    const copy = structuredClone(moved);
    const after = adoptDiscAfterMove(moved, 0);
    expect(moved).toEqual(copy);
    expect(after[1]).toBe(moved[1]);
  });

  it("ignores an index outside the list", () => {
    expect(discsOf(adoptDiscAfterMove(rows([1, 2]), 5))).toEqual([1, 2]);
    expect(adoptDiscAfterMove(rows([1]), 0)).toHaveLength(1);
  });
});

describe("start and join a disc (#222)", () => {
  const rows = (discs: (number | undefined)[]) => discs.map((discNumber, i) => ({ key: `t${i + 1}`, discNumber }));
  const discsOf = (list: { discNumber?: number }[]) => list.map((r) => r.discNumber);

  it("splits a no-disc album at row 3", () => {
    const after = startDiscAt(rows(Array(6).fill(undefined)), 3);
    expect(discsOf(after)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("splits again later", () => {
    const once = startDiscAt(rows(Array(6).fill(undefined)), 2);
    expect(discsOf(startDiscAt(once, 4))).toEqual([1, 1, 2, 2, 3, 3]);
    // Splitting inside the first disc shifts the later discs up.
    expect(discsOf(startDiscAt(rows([1, 1, 1, 1, 2, 2]), 2))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("joining back to one disc clears every disc number", () => {
    const split = startDiscAt(rows(Array(4).fill(undefined)), 2);
    const joined = joinPreviousDisc(split, 2);
    expect(discsOf(joined)).toEqual([undefined, undefined, undefined, undefined]);
    for (const r of joined) expect(r).not.toHaveProperty("discNumber");
  });

  it("joins in the middle of three discs", () => {
    expect(discsOf(joinPreviousDisc(rows([1, 1, 2, 2, 3, 3]), 2))).toEqual([1, 1, 1, 1, 2, 2]);
    expect(discsOf(joinPreviousDisc(rows([1, 1, 2, 2, 3, 3]), 4))).toEqual([1, 1, 2, 2, 2, 2]);
  });

  it("numbers from the first row's disc, and keeps a single range that does not start at 1", () => {
    expect(discsOf(joinPreviousDisc(rows([2, 2, 3, 3]), 2))).toEqual([2, 2, 2, 2]);
  });

  it("offers nothing on row 0", () => {
    expect(discActionsFor([undefined, undefined, undefined], 0)).toEqual({});
    expect(discActionsFor([1, 1, 2], 0)).toEqual({});
  });

  it("offers only Join on the first row of disc 2, and Start elsewhere", () => {
    expect(discActionsFor([1, 1, 2, 2], 2)).toEqual({ join: 1 });
    expect(discActionsFor([1, 1, 2, 2], 1)).toEqual({ start: 2 });
    expect(discActionsFor([1, 1, 2, 2], 3)).toEqual({ start: 3 });
    expect(discActionsFor([undefined, undefined, undefined], 2)).toEqual({ start: 2 });
    expect(discActionsFor([1, 2, 3], 2)).toEqual({ join: 2 });
  });

  it("ignores a row that cannot take the action, and leaves its input alone", () => {
    const list = rows([1, 1, 2, 2]);
    const copy = structuredClone(list);
    expect(discsOf(startDiscAt(list, 0))).toEqual([1, 1, 2, 2]);
    expect(discsOf(startDiscAt(list, 2))).toEqual([1, 1, 2, 2]);
    expect(discsOf(joinPreviousDisc(list, 1))).toEqual([1, 1, 2, 2]);
    expect(discsOf(joinPreviousDisc(list, 0))).toEqual([1, 1, 2, 2]);
    expect(discsOf(startDiscAt(list, 9))).toEqual([1, 1, 2, 2]);
    expect(list).toEqual(copy);
  });
});

describe("discs stop at 99 (#222)", () => {
  const rows = (discs: number[]) => discs.map((discNumber, i) => ({ key: `t${i}`, discNumber }));
  const discsOf = (list: { discNumber?: number }[]) => list.map((r) => r.discNumber);

  it("offers no Start on [99,99] and leaves the discs as they are", () => {
    expect(discActionsFor([99, 99], 1)).toEqual({});
    expect(discsOf(startDiscAt(rows([99, 99]), 1))).toEqual([99, 99]);
  });

  it("splits [98,98,98] at 1 to [98,99,99], then offers no further Start", () => {
    const once = startDiscAt(rows([98, 98, 98]), 1);
    expect(discsOf(once)).toEqual([98, 99, 99]);
    expect(discActionsFor(discsOf(once), 2)).toEqual({});
    expect(discsOf(startDiscAt(once, 2))).toEqual([98, 99, 99]);
    expect(discActionsFor(discsOf(once), 1)).toEqual({ join: 98 });
  });
});
