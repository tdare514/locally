/** Days a play-day bucket is kept (`docs/plans/193-plays-by-day.md`, decision 6). */
export const RETENTION_DAYS = 400;

/** The most plays one track can hold in one day bucket, as for counts on the sync API (plan, Security). */
export const MAX_DAY_COUNT = 1_000_000;

const MS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar date, as `YYYY-MM-DD`, that `ms` falls on in `timeZone` (the system zone when
 * omitted). This is the day a play lands in: the Mac's local zone at play time, never UTC's.
 */
export function localDay(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}

/** Days since 1970-01-01 for a real calendar date written `YYYY-MM-DD`; null for anything else (`2026-02-30`, garbage). */
export function parseDay(value: string): number | null {
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms / MS_PER_DAY;
}

/** Inverse of {@link parseDay}. */
export function formatDay(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The `days` of a `plays.json` entry as it is read: keys that aren't real calendar dates and counts
 * that aren't whole numbers from 1 to {@link MAX_DAY_COUNT} are dropped, so a bad `days` (a hand edit,
 * `2026-02-31`, `1e308`) never costs the totals or overflows a sum. Undefined when nothing is left.
 */
export function cleanStoredDays(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const days: Record<string, number> = {};
  let any = false;
  for (const day in source) {
    const count = source[day];
    if (
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 1 &&
      count <= MAX_DAY_COUNT &&
      parseDay(day) !== null
    ) {
      days[day] = count;
      any = true;
    }
  }
  return any ? days : undefined;
}

/**
 * `days` without the buckets older than {@link RETENTION_DAYS} before `today` (that day's own bucket is
 * kept) or later than tomorrow (a clock that ran ahead); undefined when none are left.
 */
export function pruneDays(days: Record<string, number> | undefined, today: string): Record<string, number> | undefined {
  if (!days) return undefined;
  const todayNumber = parseDay(today);
  if (todayNumber === null) return days;
  // `YYYY-MM-DD` strings sort the same as the dates they name.
  const cutoff = formatDay(todayNumber - RETENTION_DAYS);
  const tomorrow = formatDay(todayNumber + 1);
  const kept: Record<string, number> = {};
  let any = false;
  for (const day of Object.keys(days)) {
    if (day >= cutoff && day <= tomorrow) {
      kept[day] = days[day];
      any = true;
    }
  }
  return any ? kept : undefined;
}
