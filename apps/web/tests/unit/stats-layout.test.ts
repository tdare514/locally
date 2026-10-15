import { describe, expect, it } from "vitest";
import type { StatItem } from "../../src/lib/play-stats";
import { SEA_TIER_SIZES, seaTiers, sortItems } from "../../src/lib/stats-layout";

function item(rank: number, title: string, lastPlayedDay: string | null): StatItem {
  return { id: title, rank, title, subtitle: "Artist", plays: 100 - rank, cover: null, releaseId: "r", lastPlayedDay };
}

const items = [
  item(1, "Delta", "2026-10-10"),
  item(2, "alpha", "2026-10-14"),
  item(3, "Charlie", null),
  item(4, "Bravo", "2026-10-14"),
  item(5, "Echo", null),
];

describe("sortItems", () => {
  it("keeps rank order for plays and does not change the input", () => {
    const before = items.map((i) => i.title);
    expect(sortItems(items, "plays").map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(items.map((i) => i.title)).toEqual(before);
  });

  it("sorts by name, ignoring case", () => {
    expect(sortItems(items, "name").map((i) => i.title)).toEqual(["alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  });

  it("sorts by the latest day first, then rank, with unknown days last", () => {
    expect(sortItems(items, "recent").map((i) => i.title)).toEqual(["alpha", "Bravo", "Delta", "Charlie", "Echo"]);
  });

  it("keeps each item's plays rank whatever the order", () => {
    expect(sortItems(items, "name").map((i) => i.rank)).toEqual([2, 4, 3, 1, 5]);
  });
});

describe("seaTiers", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("cuts the sea into the biggest six, the next eight and the rest, in rank order", () => {
    const [a, b, c] = seaTiers(many(20));
    expect(SEA_TIER_SIZES).toEqual([6, 8]);
    expect(a).toEqual(many(6));
    expect(b).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(c).toEqual([15, 16, 17, 18, 19, 20]);
  });

  it("drops groups with nothing in them", () => {
    expect(seaTiers([])).toEqual([]);
    expect(seaTiers(many(4))).toEqual([many(4)]);
    expect(seaTiers(many(10))).toHaveLength(2);
  });
});
