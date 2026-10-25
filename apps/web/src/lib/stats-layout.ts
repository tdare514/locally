/** Ordering and grouping for the Stats page's list and grid (#145). Pure. */

import type { StatItem } from "./play-stats";
import { formatCount } from "./stats-copy";

export type SortKey = "plays" | "name" | "recent";

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "plays", label: "Plays" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently played" },
];

/** Local midnight of a `YYYY-MM-DD`, in ms; null when absent or not a date. */
function startOfLocalDayMs(day: string | null): number | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * The list in the chosen order. Rows keep their plays rank under any sort, so a name or recency
 * sort still shows who is on top. Recently played puts the latest play first by one key per row: the later
 * of its time and the start of its day (on the same day an item with a time sits above one without);
 * items with no known day go last, in rank order, as do ties.
 */
export function sortItems(items: StatItem[], sort: SortKey): StatItem[] {
  const copy = [...items];
  if (sort === "name") {
    return copy.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.rank - b.rank);
  }
  if (sort === "recent") {
    // One key per row, so the order is total: the later of the play's time and the start of its local day.
    // A timed play on a day is at or above an untimed one of the same day; rows with neither go last, by rank.
    const keyOf = (i: StatItem): number => Math.max(i.lastPlayedAt ?? -Infinity, startOfLocalDayMs(i.lastPlayedDay) ?? -Infinity);
    const keys = new Map(copy.map((i) => [i, keyOf(i)] as const));
    return copy.sort((a, b) => {
      const ka = keys.get(a) as number;
      const kb = keys.get(b) as number;
      if (ka !== kb) return ka > kb ? -1 : 1;
      return a.rank - b.rank;
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
