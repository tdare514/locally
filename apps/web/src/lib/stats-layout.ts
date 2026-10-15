/** Ordering and grouping for the Stats page's list and grid (#145). Pure. */

import type { StatItem } from "./play-stats";

export type SortKey = "plays" | "name" | "recent";

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "plays", label: "Plays" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently played" },
];

/**
 * The list in the chosen order. Rows keep their plays rank under any sort, so a name or recency
 * sort still shows who is on top. Recently played puts the latest day first; items with no known
 * day go last, in rank order, as do ties.
 */
export function sortItems(items: StatItem[], sort: SortKey): StatItem[] {
  const copy = [...items];
  if (sort === "name") {
    return copy.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.rank - b.rank);
  }
  if (sort === "recent") {
    return copy.sort((a, b) => {
      if (a.lastPlayedDay === b.lastPlayedDay) return a.rank - b.rank;
      if (a.lastPlayedDay === null) return 1;
      if (b.lastPlayedDay === null) return -1;
      return a.lastPlayedDay < b.lastPlayedDay ? 1 : -1;
    });
  }
  return copy;
}

/** How many covers sit in each of the sea's first two sizes; everything after is the third. */
export const SEA_TIER_SIZES = [6, 8] as const;

/** The sea in rank order, cut into three sizes: the first six biggest, the next eight middling,
 * the rest small. Empty groups are dropped. */
export function seaTiers<T>(items: T[]): T[][] {
  const [first, second] = SEA_TIER_SIZES;
  return [items.slice(0, first), items.slice(first, first + second), items.slice(first + second)].filter(
    (group) => group.length > 0,
  );
}
