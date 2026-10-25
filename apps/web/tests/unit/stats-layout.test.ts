import { describe, expect, it } from "vitest";
import type { StatItem } from "../../src/lib/play-stats";
import { SEA_TIER_SIZES, STATS_PAGE_SIZE, keepRecent, moreLabel, nextShown, seaTiers, sortItems } from "../../src/lib/stats-layout";

function item(rank: number, title: string, lastPlayedDay: string | null): StatItem {
  return { id: title, rank, title, subtitle: "Artist", plays: 100 - rank, cover: null, releaseId: "r", lastPlayedDay, lastPlayedAt: null, minutes: null };
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

  describe("recent order with timestamps", () => {
    const at = (rank: number, title: string, day: string, hh: number): StatItem => ({
      ...item(rank, title, day),
      lastPlayedAt: new Date(`${day}T${String(hh).padStart(2, "0")}:00:00`).getTime(),
    });
    const titles = (list: StatItem[]) => sortItems(list, "recent").map((i) => i.title);

    it("an evening play sorts above a morning one of the same day, whatever the rank", () => {
      expect(titles([at(1, "morning", "2026-10-14", 9), at(2, "evening", "2026-10-14", 21)])).toEqual(["evening", "morning"]);
    });

    it("on the same day an item with a time sits above one without, then rank breaks ties", () => {
      const list = [item(1, "noTime1", "2026-10-14"), item(2, "noTime2", "2026-10-14"), at(3, "timed", "2026-10-14", 8)];
      expect(titles(list)).toEqual(["timed", "noTime1", "noTime2"]);
    });

    it("a later day wins over an earlier timed play, and no day goes last", () => {
      const list = [item(1, "none", null), at(2, "old", "2026-10-13", 23), item(3, "newer", "2026-10-14")];
      expect(titles(list)).toEqual(["newer", "old", "none"]);
    });

    it("is a consistent order: any input permutation gives the same result", () => {
      const list = [at(1, "a", "2026-10-14", 9), item(2, "b", "2026-10-14"), at(3, "c", "2026-10-14", 21), item(4, "d", "2026-10-15"), item(5, "e", null)];
      const expected = titles(list);
      expect(expected).toEqual(["d", "c", "a", "b", "e"]);
      expect(titles([...list].reverse())).toEqual(expected);
      expect(titles([list[2], list[4], list[0], list[3], list[1]])).toEqual(expected);
    });
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

describe("paging", () => {
  it("adds a page and stops at the total", () => {
    expect(nextShown(STATS_PAGE_SIZE, 1000)).toBe(200);
    expect(nextShown(STATS_PAGE_SIZE, 137)).toBe(137);
    expect(nextShown(200, 137)).toBe(137);
  });

  it("labels the button", () => {
    expect(moreLabel(100, 1000)).toBe("Show 100 more");
    expect(moreLabel(100, 200)).toBe("Show 100 more");
    expect(moreLabel(100, 137)).toBe("Show 37 more");
    expect(moreLabel(100, 101)).toBe("Show 1 more");
  });
});

describe("keepRecent", () => {
  const filled = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

  it("keeps everything while under the limit", () => {
    const { next, evicted } = keepRecent(filled(3), "new", 99);
    expect(Object.keys(next)).toEqual(["k0", "k1", "k2", "new"]);
    expect(evicted).toEqual([]);
  });

  it("keeps the new key and the 7 newest others, naming the rest", () => {
    const { next, evicted } = keepRecent(filled(10), "new", 99);
    expect(Object.keys(next)).toEqual(["k3", "k4", "k5", "k6", "k7", "k8", "k9", "new"]);
    expect(evicted).toEqual(["k0", "k1", "k2"]);
  });

  it("moves a stored key to the newest place without evicting it", () => {
    const { next, evicted } = keepRecent(filled(8), "k0", 5);
    expect(Object.keys(next)).toEqual(["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k0"]);
    expect(next.k0).toBe(5);
    expect(evicted).toEqual([]);
  });
});
