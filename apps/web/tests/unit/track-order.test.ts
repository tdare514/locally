import { describe, expect, it } from "vitest";
import {
  applyTrackEdits,
  roomShift,
  moveAnnouncement,
  moveItem,
  nearestSlot,
  slotAfterMove,
  stepTarget,
} from "../../src/lib/track-order";

describe("moveItem", () => {
  it("moves an item down and up, keeping the rest in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves to either end", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b", "c"];
    moveItem(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns the same array for a no-op or an out-of-range index", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 1, 1)).toBe(input);
    expect(moveItem(input, -1, 1)).toBe(input);
    expect(moveItem(input, 0, 3)).toBe(input);
    expect(moveItem(input, 0.5, 1)).toBe(input);
    expect(moveItem([], 0, 0)).toEqual([]);
  });
});

describe("stepTarget (keyboard step)", () => {
  it("steps one place up or down", () => {
    expect(stepTarget(2, -1, 5)).toBe(1);
    expect(stepTarget(2, 1, 5)).toBe(3);
  });

  it("refuses to step past either end", () => {
    expect(stepTarget(0, -1, 5)).toBeNull();
    expect(stepTarget(4, 1, 5)).toBeNull();
    expect(stepTarget(0, 1, 1)).toBeNull();
  });

  it("walks an item through the list one press at a time", () => {
    let items = ["a", "b", "c"];
    let index = 0;
    for (let press = 0; press < 5; press++) {
      const target = stepTarget(index, 1, items.length);
      if (target === null) break;
      items = moveItem(items, index, target);
      index = target;
    }
    expect(items).toEqual(["b", "c", "a"]);
    expect(index).toBe(2);
  });
});

describe("nearestSlot", () => {
  const centers = [24, 72, 120, 168];

  it("picks the slot whose centre is closest", () => {
    expect(nearestSlot(centers, 0)).toBe(0);
    expect(nearestSlot(centers, 47)).toBe(0);
    expect(nearestSlot(centers, 49)).toBe(1);
    expect(nearestSlot(centers, 119)).toBe(2);
    expect(nearestSlot(centers, 500)).toBe(3);
  });
});

describe("roomShift", () => {
  // Evenly spaced rows: 48px apart, as in a list with no disc headings.
  const stride = 48;
  const centers = [24, 72, 120, 168, 216];
  const room = (from: number, to: number) => centers.map((_, i) => roomShift(centers, i, from, to));

  it("slides the rows between a downward drag up by one stride", () => {
    expect(room(1, 3)).toEqual([0, 0, -48, -48, 0]);
  });

  it("slides the rows between an upward drag down by one stride", () => {
    expect(room(3, 1)).toEqual([0, 48, 48, 0, 0]);
  });

  it("leaves everything alone while the held row is over its own slot", () => {
    expect(room(2, 2)).toEqual([0, 0, 0, 0, 0]);
  });

  it("with evenly spaced rows, matches the fixed stride the drag used before disc headings (#118)", () => {
    for (let from = 0; from < centers.length; from++) {
      for (let to = 0; to < centers.length; to++) {
        centers.forEach((_, i) => {
          const oldFixedStride = i === from ? 0 : (slotAfterMove(i, from, to) - i) * stride;
          expect(roomShift(centers, i, from, to)).toBe(oldFixedStride);
        });
      }
    }
  });

  it("agrees with moveItem: the shifted rows land where the committed order puts them", () => {
    const items = ["a", "b", "c", "d", "e"];
    const slots = [0, 1, 2, 3, 4];
    for (const [from, to] of [[0, 4], [4, 0], [1, 3], [3, 1], [2, 2]]) {
      const after = moveItem(items, from, to);
      items.forEach((item, i) => {
        if (i === from) return;
        const visualSlot = i + roomShift(slots, i, from, to);
        expect(visualSlot).toBe(after.indexOf(item));
      });
    }
  });

  it("follows a larger gap, such as a heading between two rows, exactly", () => {
    // A 28px heading sits above the third row, so its centre is 28px further down.
    const withHeading = [24, 72, 148, 196, 244];
    // Holding the first row over the fourth slot moves rows 1 to 3 up into the slot above each.
    expect(roomShift(withHeading, 1, 0, 3)).toBe(24 - 72);
    expect(roomShift(withHeading, 2, 0, 3)).toBe(72 - 148);
    expect(roomShift(withHeading, 3, 0, 3)).toBe(148 - 196);
    expect(roomShift(withHeading, 4, 0, 3)).toBe(0);
  });
});

describe("slotAfterMove", () => {
  it("gives the position every row will hold after the move", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (const [from, to] of [[0, 4], [4, 0], [1, 3], [3, 1], [2, 2]]) {
      const after = moveItem(items, from, to);
      items.forEach((item, i) => expect(after[slotAfterMove(i, from, to)]).toBe(item));
    }
  });
});

describe("moveAnnouncement", () => {
  it("names the track, its new position and the count", () => {
    expect(moveAnnouncement("Midnight", 3, 8)).toBe("Moved Midnight to position 3 of 8");
  });

  it("falls back to 'track' for an untitled row", () => {
    expect(moveAnnouncement("  ", 1, 2)).toBe("Moved track to position 1 of 2");
  });
});

describe("applyTrackEdits (the import list follows the editor)", () => {
  interface Entry {
    key: string;
    file: string;
    title: string;
  }
  const entries: Entry[] = [
    { key: "k1", file: "one.mp3", title: "One" },
    { key: "k2", file: "two.mp3", title: "Two" },
    { key: "k3", file: "three.mp3", title: "Three" },
  ];

  it("keeps each file with its row when the editor reorders", () => {
    const dragged = moveItem(
      entries.map((e) => ({ key: e.key, title: e.title })),
      2,
      0,
    );
    const next = applyTrackEdits(entries, dragged);
    expect(next.map((e) => e.file)).toEqual(["three.mp3", "one.mp3", "two.mp3"]);
    // Import numbers tracks by position in this array.
    expect(next.map((e, i) => ({ title: e.title, trackNumber: i + 1 }))).toEqual([
      { title: "Three", trackNumber: 1 },
      { title: "One", trackNumber: 2 },
      { title: "Two", trackNumber: 3 },
    ]);
  });

  it("takes edited titles and drops removed rows", () => {
    const next = applyTrackEdits(entries, [
      { key: "k1", title: "Renamed" },
      { key: "k3", title: "Three" },
    ]);
    expect(next).toEqual([
      { key: "k1", file: "one.mp3", title: "Renamed" },
      { key: "k3", file: "three.mp3", title: "Three" },
    ]);
  });

  it("takes a disc the editor gave a row, and leaves rows without one alone", () => {
    const withDiscs = [
      { key: "k1", file: "one.mp3", title: "One", discNumber: 1 },
      { key: "k2", file: "two.mp3", title: "Two", discNumber: 2 },
    ];
    const next = applyTrackEdits(withDiscs, [
      { key: "k2", title: "Two", discNumber: 1 },
      { key: "k1", title: "One", discNumber: 1 },
    ]);
    expect(next.map((e) => e.discNumber)).toEqual([1, 1]);
    expect(applyTrackEdits(entries, [{ key: "k1", title: "One" }])[0]).not.toHaveProperty("discNumber");
  });

  it("ignores a row the import list does not hold", () => {
    expect(applyTrackEdits(entries, [{ key: "ghost", title: "x" }])).toEqual([]);
  });
});
