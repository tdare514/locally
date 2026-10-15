/** Ordering and grouping for the Stats page's list and grid (#145). Pure. */

import type { StatItem } from "./play-stats";
import { formatCount } from "./stats-copy";

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

/** How many rows or tiles show at first, and how many each "Show more" adds. */
export const STATS_PAGE_SIZE = 100;

/** How many are showing after one more page, never past the total. */
export function nextShown(shown: number, total: number): number {
  return Math.min(total, shown + STATS_PAGE_SIZE);
}

/** The "Show more" button's text: "Show 100 more", or "Show 37 more" when fewer remain. */
export function moreLabel(shown: number, total: number): string {
  return `Show ${formatCount(Math.min(STATS_PAGE_SIZE, Math.max(0, total - shown)))} more`;
}

/** At most `max` periods' reads are kept. Storing `key` keeps it plus the newest others, and says
 * which keys were dropped so the caller can forget when they were read. */
export const MAX_KEPT_READS = 8;

export function keepRecent<T>(prev: Partial<Record<string, T>>, key: string, value: T): { next: Record<string, T>; evicted: string[] } {
  const others = Object.keys(prev).filter((k) => k !== key);
  const kept = others.slice(-(MAX_KEPT_READS - 1));
  const next: Record<string, T> = {};
  for (const k of kept) next[k] = prev[k] as T;
  next[key] = value;
  return { next, evicted: others.slice(0, others.length - kept.length) };
}
