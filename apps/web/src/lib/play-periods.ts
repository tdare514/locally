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

/**
 * The days a period covers, ending today, in the Mac's local time (the date parts of `today` as
 * its own zone shows them). Today is that one day; the week starts on `firstDay` (1 Monday to 7
 * Sunday, as `Intl.Locale` weekInfo gives it; anything else is read as Monday) and runs to today;
 * the month runs from the 1st to today.
 */
export function periodRange(period: StatsPeriod, today: Date, firstDay: number = MONDAY): DayRange {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
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
 * `Intl.Locale` refuses or an engine that does not know week data. */
export function firstDayForLanguage(language: string | undefined): number {
  try {
    return firstDayOf(new Intl.Locale(language ?? "") as unknown as WeekInfoLocale);
  } catch {
    return MONDAY;
  }
}
