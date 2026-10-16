/** The words on the Stats page (#145): period names, the digest sentence, dates, the coverage
 * line. Pure, English, sentence case, no clock: "today" comes in as an argument. */

import { addDays, type PageKind, type PeriodSelection } from "./play-periods";
import { playsLabel } from "./plays-copy";

/** The period control's options, shortest first. */
export const PAGE_PERIODS: { value: PageKind; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year, month: month - 1, date };
}

/** "15 Oct", or "15 Oct 2025" when the year is not today's. */
export function shortDay(day: string, today: string): string {
  const d = parts(day);
  const base = `${d.date} ${MONTHS[d.month]}`;
  return d.year === parts(today).year ? base : `${base} ${d.year}`;
}

/** Plays with thousands separators. en-US on purpose, so the digits do not depend on the machine. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1 play", "1,204 plays". */
export function playsCount(n: number): string {
  return n === 1 ? playsLabel(1) : `${formatCount(n)} plays`;
}

/** "Today", "Last week", "3 months ago": the name of a period on the control. */
export function periodLabel({ kind, back }: PeriodSelection): string {
  switch (kind) {
    case "all":
      return "All time";
    case "today":
      return back === 0 ? "Today" : back === 1 ? "Yesterday" : `${back} days ago`;
    case "week":
      return back === 0 ? "This week" : back === 1 ? "Last week" : `${back} weeks ago`;
    case "month":
      return back === 0 ? "This month" : back === 1 ? "Last month" : `${back} months ago`;
    case "year":
      return back === 0 ? "This year" : back === 1 ? "Last year" : `${back} years ago`;
  }
}

/** The same period inside a sentence: "this week", "last month". */
export function periodWhen(selection: PeriodSelection): string {
  const label = periodLabel(selection);
  return selection.kind === "all" ? "so far" : label.charAt(0).toLowerCase() + label.slice(1);
}

/** The dates under the period's name: "12 to 18 Oct", "September 2026", "2026". */
export function periodDetail(selection: PeriodSelection, range: { from: string; to: string }, today: string): string {
  const from = parts(range.from);
  const to = parts(range.to);
  switch (selection.kind) {
    case "all":
      return "Everything counted";
    case "today": {
      const weekday = WEEKDAYS[new Date(Date.UTC(from.year, from.month, from.date)).getUTCDay()];
      return `${weekday} ${shortDay(range.from, today)}`;
    }
    case "week":
      if (range.from === range.to) return shortDay(range.from, today);
      return from.month === to.month && from.year === to.year
        ? `${from.date} to ${shortDay(range.to, today)}`
        : `${shortDay(range.from, today)} to ${shortDay(range.to, today)}`;
    case "month":
      return `${MONTHS_LONG[from.month]} ${from.year}`;
    case "year":
      return String(from.year);
  }
}

/** The line under the heading: "You played your tracks 121 times this week, mostly Night Bus to
 * Nowhere." It speaks of tracks whichever tab is showing. */
export function digestSentence(selection: PeriodSelection, total: number, topTrack: string | null): string {
  const when = periodWhen(selection);
  if (total <= 0 || topTrack === null) {
    return selection.kind === "all" ? "No plays counted yet." : emptyPeriodLine(selection);
  }
  const times = total === 1 ? "time" : "times";
  return selection.kind === "all"
    ? `You have played your tracks ${formatCount(total)} ${times} so far, mostly ${topTrack}.`
    : `You played your tracks ${formatCount(total)} ${times} ${when}, mostly ${topTrack}.`;
}

/** The quiet line for a period with no plays (when plays exist from before it). */
export function emptyPeriodLine(selection: PeriodSelection): string {
  const when = periodWhen(selection);
  return selection.back === 0 ? `No plays yet ${when}.` : `No plays ${when}.`;
}

/** The "last played" column: "Today", "Yesterday", "3 days ago", then the date; a dash when no day is known. */
export function lastPlayedLabel(day: string | null, today: string): string {
  if (!day) return "–";
  if (day >= today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  for (let n = 2; n <= 6; n++) if (day === addDays(today, -n)) return `${n} days ago`;
  return shortDay(day, today);
}

/** What the page counts, said quietly. When the sync service's plays are merged in (#202) the
 * numbers are one total across devices, so no "since" date: `countingSince` is only this Mac's
 * earliest day. Otherwise it says "on this Mac" and since when. */
export function countingLine(counting: boolean, countingSince: string | null, today: string, allDevices = false): string {
  if (!counting) return allDevices ? "Play counting is off on this Mac." : "Play counting is off.";
  if (allDevices) return "Collected across all your devices.";
  if (!countingSince) return "Counting plays on this Mac.";
  return `Counted on this Mac since ${shortDay(countingSince, today)}.`;
}
