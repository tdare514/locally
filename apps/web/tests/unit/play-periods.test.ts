import { describe, expect, it } from "vitest";
import { RETENTION_DAYS as SERVER_RETENTION_DAYS } from "../../src/server/plays/playDays";
import { parseSummaryRange } from "../../src/server/plays/playsSummary";
import {
  MAX_RANGE_DAYS,
  RETENTION_DAYS,
  addDays,
  canStepBack,
  selectionRange,
  type PageKind,
  firstDayForLanguage,
  firstDayOf,
  localDayString,
  msUntilNextLocalMidnight,
  periodRange,
  periodRangeOfDay,
} from "../../src/lib/play-periods";

// "Today" is built from local parts, so these hold in whatever zone the tests run in.
const day = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

const MON = 1;
const SUN = 7;
const SAT = 6;

describe("periodRange: today", () => {
  it("is the one day", () => {
    expect(periodRange("today", day(2026, 10, 15))).toEqual({ from: "2026-10-15", to: "2026-10-15" });
  });

  it("pads single digits", () => {
    expect(periodRange("today", day(2026, 3, 5))).toEqual({ from: "2026-03-05", to: "2026-03-05" });
  });

  it("takes the date on the Mac's clock, even just after midnight or just before it", () => {
    expect(periodRange("today", day(2026, 10, 15, 0, 1)).to).toBe("2026-10-15");
    expect(periodRange("today", day(2026, 10, 15, 23, 59)).to).toBe("2026-10-15");
  });
});

describe("periodRange: this week", () => {
  // 2026-10-15 is a Thursday.
  const thursday = day(2026, 10, 15);

  it("starts on Monday by default", () => {
    expect(periodRange("week", thursday)).toEqual({ from: "2026-10-12", to: "2026-10-15" });
    expect(periodRange("week", thursday, MON)).toEqual({ from: "2026-10-12", to: "2026-10-15" });
  });

  it("starts on Sunday where the week does", () => {
    expect(periodRange("week", thursday, SUN)).toEqual({ from: "2026-10-11", to: "2026-10-15" });
  });

  it("starts on Saturday where the week does", () => {
    expect(periodRange("week", thursday, SAT)).toEqual({ from: "2026-10-10", to: "2026-10-15" });
  });

  it("is just today on the first day of the week", () => {
    const monday = day(2026, 10, 12);
    expect(periodRange("week", monday, MON)).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    const sunday = day(2026, 10, 11);
    expect(periodRange("week", sunday, SUN)).toEqual({ from: "2026-10-11", to: "2026-10-11" });
  });

  it("reaches back a whole week on the last day of it", () => {
    expect(periodRange("week", day(2026, 10, 18), MON)).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(periodRange("week", day(2026, 10, 17), SUN)).toEqual({ from: "2026-10-11", to: "2026-10-17" });
  });

  it("puts Sunday at the end of a Monday week and the start of a Sunday week", () => {
    const sunday = day(2026, 10, 11);
    expect(periodRange("week", sunday, MON)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("week", sunday, SUN)).toEqual({ from: "2026-10-11", to: "2026-10-11" });
  });

  it("crosses into the month before", () => {
    // 2026-03-01 is a Sunday.
    expect(periodRange("week", day(2026, 3, 1), MON)).toEqual({ from: "2026-02-23", to: "2026-03-01" });
    expect(periodRange("week", day(2026, 3, 4), SUN)).toEqual({ from: "2026-03-01", to: "2026-03-04" });
  });

  it("crosses into the year before", () => {
    // 2027-01-01 is a Friday.
    expect(periodRange("week", day(2027, 1, 1), MON)).toEqual({ from: "2026-12-28", to: "2027-01-01" });
  });

  it("counts a leap day", () => {
    // 2028-03-01 is a Wednesday; the week back to Monday passes 29 February.
    expect(periodRange("week", day(2028, 3, 1), MON)).toEqual({ from: "2028-02-28", to: "2028-03-01" });
    expect(periodRange("week", day(2028, 3, 2), MON).from).toBe("2028-02-28");
  });

  it("is not thrown by the clocks changing", () => {
    // US clocks go back on 2026-11-01 and forward on 2026-03-08.
    expect(periodRange("week", day(2026, 11, 2), SUN)).toEqual({ from: "2026-11-01", to: "2026-11-02" });
    expect(periodRange("week", day(2026, 11, 3), MON)).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(periodRange("week", day(2026, 3, 9), SUN)).toEqual({ from: "2026-03-08", to: "2026-03-09" });
    expect(periodRange("week", day(2026, 3, 8), MON)).toEqual({ from: "2026-03-02", to: "2026-03-08" });
  });

  it("reads a first day it cannot use as Monday", () => {
    for (const bad of [0, 8, -1, 1.5, Number.NaN]) {
      expect(periodRange("week", thursday, bad)).toEqual({ from: "2026-10-12", to: "2026-10-15" });
    }
  });
});

describe("periodRange: this month", () => {
  it("runs from the 1st to today", () => {
    expect(periodRange("month", day(2026, 10, 15))).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });

  it("is just the 1st on the 1st", () => {
    expect(periodRange("month", day(2026, 10, 1))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("does not depend on the first day of the week", () => {
    expect(periodRange("month", day(2026, 10, 15), SUN)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });

  it("works at the ends of the year", () => {
    expect(periodRange("month", day(2026, 12, 31))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange("month", day(2027, 1, 1))).toEqual({ from: "2027-01-01", to: "2027-01-01" });
  });
});

describe("periodRange: always a range the summary accepts", () => {
  it("is never longer than 31 days and never starts after it ends", () => {
    for (let d = 0; d < 800; d += 7) {
      const today = new Date(2026, 0, 1 + d, 12);
      for (const period of ["today", "week", "month"] as const) {
        for (const first of [MON, SAT, SUN]) {
          const range = periodRange(period, today, first);
          expect(range.from <= range.to).toBe(true);
          const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
          expect(days).toBeGreaterThanOrEqual(1);
          expect(days).toBeLessThanOrEqual(31);
        }
      }
    }
  });
});

describe("periodRangeOfDay", () => {
  it("is periodRange for a date written YYYY-MM-DD", () => {
    for (const [y, m, d] of [[2026, 10, 15], [2026, 3, 1], [2027, 1, 1], [2028, 3, 1], [2026, 11, 2]]) {
      for (const period of ["today", "week", "month"] as const) {
        for (const first of [MON, SAT, SUN]) {
          expect(periodRangeOfDay(period, localDayString(day(y, m, d)), first)).toEqual(
            periodRange(period, day(y, m, d), first),
          );
        }
      }
    }
    expect(periodRangeOfDay("week", "2026-10-15", SUN)).toEqual({ from: "2026-10-11", to: "2026-10-15" });
    expect(periodRangeOfDay("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });
});

describe("localDayString", () => {
  it("is the date on the clock, padded", () => {
    expect(localDayString(day(2026, 10, 15))).toBe("2026-10-15");
    expect(localDayString(day(2026, 3, 5, 0, 0))).toBe("2026-03-05");
    expect(localDayString(day(2026, 12, 31, 23, 59))).toBe("2026-12-31");
    expect(localDayString(day(2027, 1, 1, 0, 1))).toBe("2027-01-01");
  });
});

describe("msUntilNextLocalMidnight", () => {
  const SECOND = 1000;
  const HOUR = 3_600_000;

  it("counts down to the next midnight on the clock", () => {
    // Mid-June has no clock change in any zone.
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 23, 59, 30))).toBe(30 * SECOND);
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 12, 0, 0))).toBe(12 * HOUR);
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 0, 0, 1))).toBe(24 * HOUR - SECOND);
  });

  it("is a whole day at midnight, never zero", () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 0, 0, 0))).toBe(24 * HOUR);
  });

  it("lands on the next date at the start of it, across a whole year of clock changes", () => {
    // In a zone with daylight saving this walks over the 23- and 25-hour days.
    for (let d = 0; d < 366; d++) {
      for (const hour of [0, 1, 2, 3, 12, 23]) {
        const now = new Date(2026, 0, 1 + d, hour, 30);
        const ms = msUntilNextLocalMidnight(now);
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(25 * HOUR);
        const later = new Date(now.getTime() + ms);
        const tomorrow = new Date(2026, 0, 2 + d);
        expect(localDayString(later)).toBe(localDayString(tomorrow));
        // Midnight itself, unless the zone skips it that night.
        expect(later.getHours() <= 1).toBe(true);
      }
    }
  });
});

describe("firstDayOf", () => {
  it("reads the weekInfo property", () => {
    expect(firstDayOf({ weekInfo: { firstDay: 7 } })).toBe(SUN);
    expect(firstDayOf({ weekInfo: { firstDay: 1 } })).toBe(MON);
    expect(firstDayOf({ weekInfo: { firstDay: 6 } })).toBe(SAT);
  });

  it("prefers getWeekInfo() where the engine has it", () => {
    expect(firstDayOf({ getWeekInfo: () => ({ firstDay: 7 }), weekInfo: { firstDay: 1 } })).toBe(SUN);
  });

  it("is Monday when the engine says nothing or something unusable", () => {
    expect(firstDayOf({})).toBe(MON);
    expect(firstDayOf({ weekInfo: {} })).toBe(MON);
    expect(firstDayOf({ weekInfo: { firstDay: 0 } })).toBe(MON);
    expect(firstDayOf({ weekInfo: { firstDay: 8 } })).toBe(MON);
    expect(firstDayOf({ weekInfo: { firstDay: "7" } })).toBe(MON);
    expect(
      firstDayOf({
        getWeekInfo: () => {
          throw new Error("nope");
        },
      }),
    ).toBe(MON);
  });
});

describe("firstDayForLanguage", () => {
  it("is Monday for a tag nobody can read, or none", () => {
    expect(firstDayForLanguage(undefined)).toBe(MON);
    expect(firstDayForLanguage("")).toBe(MON);
    expect(firstDayForLanguage("not a language tag")).toBe(MON);
  });

  it("answers 1 to 7 for a real tag, whatever this engine's week data says", () => {
    const day = firstDayForLanguage("en-US");
    expect(Number.isInteger(day) && day >= 1 && day <= 7).toBe(true);
  });
});

describe("addDays", () => {
  it("moves across month, year and leap-day edges", () => {
    expect(addDays("2026-10-15", -15)).toBe("2026-09-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("selectionRange", () => {
  const today = "2026-10-15"; // a Thursday
  it("ends the current period today", () => {
    expect(selectionRange({ kind: "today", back: 0 }, today)).toEqual({ from: today, to: today });
    expect(selectionRange({ kind: "week", back: 0 }, today, MON)).toEqual({ from: "2026-10-12", to: today });
    expect(selectionRange({ kind: "month", back: 0 }, today)).toEqual({ from: "2026-10-01", to: today });
    expect(selectionRange({ kind: "year", back: 0 }, today)).toEqual({ from: "2026-01-01", to: today });
  });

  it("matches the sidebar's ranges for today, week and month", () => {
    for (const kind of ["today", "week", "month"] as const) {
      expect(selectionRange({ kind, back: 0 }, today, SUN)).toEqual(periodRangeOfDay(kind, today, SUN));
    }
  });

  it("steps back a whole day, week, month or year", () => {
    expect(selectionRange({ kind: "today", back: 2 }, today)).toEqual({ from: "2026-10-13", to: "2026-10-13" });
    expect(selectionRange({ kind: "week", back: 1 }, today, MON)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(selectionRange({ kind: "week", back: 2 }, today, SUN)).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(selectionRange({ kind: "month", back: 1 }, today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(selectionRange({ kind: "month", back: 10 }, today)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(selectionRange({ kind: "year", back: 1 }, today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("knows February in a leap year", () => {
    expect(selectionRange({ kind: "month", back: 1 }, "2028-03-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("asks all time for the longest range the server allows, ending today", () => {
    const range = selectionRange({ kind: "all", back: 0 }, today);
    expect(range.to).toBe(today);
    expect(range.from).toBe(addDays(today, 1 - MAX_RANGE_DAYS));
  });
});

describe("canStepBack", () => {
  // 2026-10-15 minus 400 days is 2025-09-10.
  const today = "2026-10-15";

  it("allows weeks and months while their start is inside the 400 days kept", () => {
    expect(canStepBack({ kind: "week", back: 0 }, today, MON)).toBe(true);
    expect(canStepBack({ kind: "month", back: 0 }, today)).toBe(true);
    // The week of Mon 15 Sep 2025 (back 56) starts inside; the week of 8 Sep (back 57) starts before.
    expect(selectionRange({ kind: "week", back: 56 }, today, MON).from).toBe("2025-09-15");
    expect(canStepBack({ kind: "week", back: 55 }, today, MON)).toBe(true);
    expect(canStepBack({ kind: "week", back: 56 }, today, MON)).toBe(false);
    // October 2025 starts inside, September 2025 starts before 10 Sep.
    expect(canStepBack({ kind: "month", back: 11 }, today)).toBe(true);
    expect(canStepBack({ kind: "month", back: 12 }, today)).toBe(false);
  });

  it("allows the previous year only when it began within the kept days", () => {
    expect(canStepBack({ kind: "year", back: 0 }, today)).toBe(false);
    expect(canStepBack({ kind: "year", back: 0 }, "2027-01-10")).toBe(true); // 2026-01-01 is 374 days back
    expect(canStepBack({ kind: "year", back: 0 }, "2027-02-05")).toBe(true); // 2026-01-01 is exactly 400 days back
    expect(canStepBack({ kind: "year", back: 0 }, "2027-02-06")).toBe(false); // one day too far
  });

  it("has nothing before all time", () => {
    expect(canStepBack({ kind: "all", back: 0 }, today)).toBe(false);
  });
});

describe("what the page asks the server for", () => {
  it("keeps the retention numbers in step with the server", () => {
    expect(RETENTION_DAYS).toBe(SERVER_RETENTION_DAYS);
  });

  it("is never refused: every reachable period, on a spread of days, passes the server's range check", () => {
    const kinds: PageKind[] = ["today", "week", "month", "year", "all"];
    const start = "2024-01-01";
    for (let i = 0; i < 1100; i += 7) {
      const today = addDays(start, i);
      for (const firstDay of [MON, SUN, SAT]) {
        for (const kind of kinds) {
          let back = 0;
          for (;;) {
            const range = selectionRange({ kind, back }, today, firstDay);
            expect(() => parseSummaryRange(range.from, range.to, today), `${kind} ${back} on ${today}`).not.toThrow();
            if (!canStepBack({ kind, back }, today, firstDay)) break;
            back += 1;
          }
        }
      }
    }
  });
});
