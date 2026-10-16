/** Calendar-day helpers for play day buckets (`spec/sync.md`, "Play counts"). All UTC, no time zones. */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Day buckets are kept this many days; older ones are dropped on push and deleted by the daily cleanup. */
export const PLAY_DAY_RETENTION_DAYS = 400;

/** True for a strict `YYYY-MM-DD` string that is a real calendar date (2026-02-30 is not). */
export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Milliseconds at 00:00 UTC of a real `YYYY-MM-DD`. */
export function dayToMs(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

/** The UTC date of an instant, plus `offsetDays` days. */
export function utcDay(ms: number, offsetDays = 0): string {
  return new Date(ms + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of days from `from` to `to` (both real days). */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS) + 1;
}
