/** The date ranges behind the sidebar's Today / This week / This month (#203): the Mac's local
 * calendar days, written YYYY-MM-DD, for `GET /api/plays/summary?from&to`. Pure: "today" and the
 * first day of the week come in as arguments, so nothing here reads the clock or the browser. */

import type { StatsPeriod } from "./play-stats";

/** Weekday numbers as `Intl.Locale` reports them: 1 is Monday, 7 is Sunday. */
export const MONDAY = 1;

export interface DayRange {
  /** First day, `YYYY-MM-DD`. */
  from: string;
  /** Last day (inclusive), `YYYY-MM-DD`. */
  to: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A UTC timestamp's calendar date. Only used on dates built with `Date.UTC`, which has no DST. */
function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A local date as `YYYY-MM-DD`: the date parts of `date` as its own zone shows them. */
export function localDayString(date: Date): string {
  return utcDay(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * How long until the next local midnight, in ms: the time to wait before "today" changes. A day
 * with a clock change is 23 or 25 hours long, and this follows it because the next midnight is
 * built from local date parts.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

function rangeOn(period: StatsPeriod, year: number, month: number, day: number, firstDay: number): DayRange {
  const to = utcDay(Date.UTC(year, month, day));
  switch (period) {
    case "today":
      return { from: to, to };
    case "week": {
      const first = Number.isInteger(firstDay) && firstDay >= 1 && firstDay <= 7 ? firstDay : MONDAY;
      const weekday = new Date(Date.UTC(year, month, day)).getUTCDay(); // 0 is Sunday
      const daysIntoWeek = (weekday - (first % 7) + 7) % 7;
      return { from: utcDay(Date.UTC(year, month, day - daysIntoWeek)), to };
    }
    case "month":
      return { from: utcDay(Date.UTC(year, month, 1)), to };
  }
}

/**
 * The days a period covers, ending today, in the Mac's local time (the date parts of `today` as
 * its own zone shows them). Today is that one day; the week starts on `firstDay` (1 Monday to 7
 * Sunday, as `Intl.Locale` weekInfo gives it; anything else is read as Monday) and runs to today;
 * the month runs from the 1st to today.
 */
export function periodRange(period: StatsPeriod, today: Date, firstDay: number = MONDAY): DayRange {
  return rangeOn(period, today.getFullYear(), today.getMonth(), today.getDate(), firstDay);
}

/** {@link periodRange} for a local date already written `YYYY-MM-DD` (what {@link localDayString} gives). */
export function periodRangeOfDay(period: StatsPeriod, day: string, firstDay: number = MONDAY): DayRange {
  const [year, month, date] = day.split("-").map(Number);
  return rangeOn(period, year, month - 1, date, firstDay);
}

/** The part of an `Intl.Locale` that says which day the week starts on. Chrome and Safari have
 * the `weekInfo` property; newer engines also have `getWeekInfo()`; Firefox has neither. */
export interface WeekInfoLocale {
  weekInfo?: { firstDay?: unknown };
  getWeekInfo?: () => { firstDay?: unknown };
}

/** The locale's first day of the week (1 to 7), Monday when it cannot be told. */
export function firstDayOf(locale: WeekInfoLocale): number {
  let info: { firstDay?: unknown } | undefined;
  try {
    info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
  } catch {
    info = undefined;
  }
  const day = info?.firstDay;
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7 ? day : MONDAY;
}

/** The first day of the week for a BCP 47 tag such as `navigator.language`; Monday for a tag
 * `Intl.Locale` refuses or an engine that does not know week data. The week follows the browser's
 * language, not the "First day of week" in macOS Language & Region, which a page cannot read. */
export function firstDayForLanguage(language: string | undefined): number {
  try {
    return firstDayOf(new Intl.Locale(language ?? "") as unknown as WeekInfoLocale);
  } catch {
    return MONDAY;
  }
}

// ---------------------------------------------------------------------------------------------
// The Stats page (#145): five periods, each of which can step back
// ---------------------------------------------------------------------------------------------

/** How many days the Mac keeps day buckets, and so how far back a request may start. The server's
 * `RETENTION_DAYS` (server/plays/playDays.ts); a test holds the two together. */
export const RETENTION_DAYS = 400;

/** The most days one request may span (the server's `MAX_SUMMARY_DAYS`). */
export const MAX_RANGE_DAYS = 400;

/** The Stats page's periods, shortest first. */
export type PageKind = "today" | "week" | "month" | "year" | "all";

/** A period and how many steps back from the current one (0 is today, this week, ...). */
export interface PeriodSelection {
  kind: PageKind;
  back: number;
}

const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / DAY_MS);
}

/** `day` (`YYYY-MM-DD`) moved by `n` days, which may be negative. */
export function addDays(day: string, n: number): string {
  return utcDay((dayNumber(day) + n) * DAY_MS);
}

/**
 * The days a period covers, as the summary request's `from` and `to`. `today` is the Mac's local
 * date. Back 0 ends today; a period stepped back to is the whole of that day, week, month or year.
 * All time has no range of its own: it reads the summary's `allTime`, and asks for the longest
 * range the server allows so the days it still has can show "last played".
 */
export function selectionRange(
  selection: PeriodSelection,
  today: string,
  firstDay: number = MONDAY,
): DayRange {
  const back = Math.max(0, Math.floor(selection.back));
  const [year, month] = today.split("-").map(Number);
  switch (selection.kind) {
    case "today": {
      const day = addDays(today, -back);
      return { from: day, to: day };
    }
    case "week": {
      const from = addDays(periodRangeOfDay("week", today, firstDay).from, -7 * back);
      return { from, to: back === 0 ? today : addDays(from, 6) };
    }
    case "month": {
      const from = utcDay(Date.UTC(year, month - 1 - back, 1));
      return { from, to: back === 0 ? today : utcDay(Date.UTC(year, month - back, 0)) };
    }
    case "year": {
      const from = utcDay(Date.UTC(year - back, 0, 1));
      return { from, to: back === 0 ? today : utcDay(Date.UTC(year - back, 11, 31)) };
    }
    case "all":
      return { from: addDays(today, 1 - MAX_RANGE_DAYS), to: today };
  }
}

/**
 * Whether the period before this one can be asked for: it must start within the days the Mac
 * keeps (from no earlier than today minus {@link RETENTION_DAYS}), or the server would refuse the
 * range. All time has nothing before it.
 */
export function canStepBack(selection: PeriodSelection, today: string, firstDay: number = MONDAY): boolean {
  if (selection.kind === "all") return false;
  const earlier = selectionRange({ kind: selection.kind, back: selection.back + 1 }, today, firstDay);
  return earlier.from >= addDays(today, -RETENTION_DAYS);
}
