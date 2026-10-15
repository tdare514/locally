import { describe, expect, it } from "vitest";
import { cleanStoredDays, formatDay, localDay, parseDay, pruneDays } from "../../src/server/plays/playDays";

describe("localDay", () => {
  it("is the date in the given zone, not UTC's", () => {
    const at = Date.UTC(2026, 9, 16, 3, 30); // 03:30 UTC on the 16th
    expect(localDay(at, "UTC")).toBe("2026-10-16");
    expect(localDay(at, "America/New_York")).toBe("2026-10-15"); // 23:30 EDT
    expect(localDay(at, "Pacific/Auckland")).toBe("2026-10-16"); // 16:30 NZDT
    expect(localDay(Date.UTC(2026, 9, 15, 23, 30), "Pacific/Auckland")).toBe("2026-10-16"); // 12:30 NZDT next day
  });

  it("follows daylight saving: New York's clocks go back on 2026-11-01 at 06:00 UTC", () => {
    expect(localDay(Date.UTC(2026, 10, 1, 4, 30), "America/New_York")).toBe("2026-11-01"); // 00:30 EDT
    expect(localDay(Date.UTC(2026, 10, 2, 4, 30), "America/New_York")).toBe("2026-11-01"); // 23:30 EST
  });

  it("pads the month and day", () => {
    expect(localDay(Date.UTC(2026, 0, 5, 12), "UTC")).toBe("2026-01-05");
  });
});

describe("parseDay and formatDay", () => {
  it("round-trips real dates, leap days included", () => {
    for (const day of ["1970-01-01", "2024-02-29", "2026-10-15", "2026-12-31"]) {
      const n = parseDay(day);
      expect(n).not.toBeNull();
      expect(formatDay(n as number)).toBe(day);
    }
    expect((parseDay("2026-10-16") as number) - (parseDay("2026-10-15") as number)).toBe(1);
    expect((parseDay("2027-01-01") as number) - (parseDay("2026-01-01") as number)).toBe(365);
  });

  it("refuses dates that do not exist and text that is not a date", () => {
    const bad = [
      "2026-02-30",
      "2025-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-10-00",
      "2026-10-32",
      "",
      "garbage",
      "2026-1-5",
      "20261015",
      "2026-10-15T00:00:00Z",
      " 2026-10-15",
      "0050-01-01",
    ];
    for (const value of bad) expect(parseDay(value), value).toBeNull();
  });
});

describe("cleanStoredDays", () => {
  it("keeps date keys with whole positive counts and drops the rest", () => {
    const raw = { "2026-10-15": 2, "2026-10-14": 0, "2026-10-13": -1, "2026-10-12": 1.5, x: 1, "2026-13-01": 1 };
    expect(cleanStoredDays(raw)).toEqual({ "2026-10-15": 2 });
  });

  it("is undefined when nothing usable is left", () => {
    for (const raw of [undefined, null, "x", 3, [], {}, { a: 1 }]) expect(cleanStoredDays(raw)).toBeUndefined();
  });
});

describe("pruneDays", () => {
  const today = "2026-10-15";

  it("keeps the day exactly 400 days back and drops older ones", () => {
    const days = { "2025-09-09": 1, "2025-09-10": 2, "2026-10-15": 3 };
    expect(pruneDays(days, today)).toEqual({ "2025-09-10": 2, "2026-10-15": 3 });
  });

  it("is undefined when every day is old, and when there are none", () => {
    expect(pruneDays({ "2020-01-01": 1 }, today)).toBeUndefined();
    expect(pruneDays(undefined, today)).toBeUndefined();
  });
});
