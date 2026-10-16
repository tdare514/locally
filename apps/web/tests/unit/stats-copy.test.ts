import { describe, expect, it } from "vitest";
import { selectionRange } from "../../src/lib/play-periods";
import {
  countingLine,
  digestSentence,
  emptyPeriodLine,
  formatCount,
  lastPlayedLabel,
  periodDetail,
  periodLabel,
  periodWhen,
  playsCount,
  shortDay,
} from "../../src/lib/stats-copy";

const TODAY = "2026-10-15";

describe("periodLabel and periodWhen", () => {
  it("names each period and each step back", () => {
    expect(periodLabel({ kind: "today", back: 0 })).toBe("Today");
    expect(periodLabel({ kind: "today", back: 1 })).toBe("Yesterday");
    expect(periodLabel({ kind: "today", back: 3 })).toBe("3 days ago");
    expect(periodLabel({ kind: "week", back: 0 })).toBe("This week");
    expect(periodLabel({ kind: "week", back: 1 })).toBe("Last week");
    expect(periodLabel({ kind: "week", back: 2 })).toBe("2 weeks ago");
    expect(periodLabel({ kind: "month", back: 1 })).toBe("Last month");
    expect(periodLabel({ kind: "month", back: 4 })).toBe("4 months ago");
    expect(periodLabel({ kind: "year", back: 0 })).toBe("This year");
    expect(periodLabel({ kind: "year", back: 1 })).toBe("Last year");
    expect(periodLabel({ kind: "all", back: 0 })).toBe("All time");
  });

  it("reads inside a sentence", () => {
    expect(periodWhen({ kind: "week", back: 0 })).toBe("this week");
    expect(periodWhen({ kind: "month", back: 2 })).toBe("2 months ago");
    expect(periodWhen({ kind: "all", back: 0 })).toBe("so far");
  });
});

describe("periodDetail", () => {
  const detail = (kind: "today" | "week" | "month" | "year" | "all", back: number) =>
    periodDetail({ kind, back }, selectionRange({ kind, back }, TODAY, 1), TODAY);
  it("shows the dates a period covers", () => {
    expect(detail("today", 0)).toBe("Thu 15 Oct");
    expect(detail("week", 0)).toBe("12 to 15 Oct");
    expect(detail("week", 1)).toBe("5 to 11 Oct");
    expect(detail("week", 2)).toBe("28 Sep to 4 Oct");
    expect(detail("month", 1)).toBe("September 2026");
    expect(detail("year", 0)).toBe("2026");
    expect(detail("all", 0)).toBe("Everything counted");
  });
});

describe("digestSentence", () => {
  it("is the approved sentence", () => {
    expect(digestSentence({ kind: "week", back: 0 }, 121, "Night Bus to Nowhere")).toBe(
      "You played your tracks 121 times this week, mostly Night Bus to Nowhere.",
    );
  });
  it("singular, past periods, thousands and all time", () => {
    expect(digestSentence({ kind: "today", back: 0 }, 1, "Tide")).toBe("You played your tracks 1 time today, mostly Tide.");
    expect(digestSentence({ kind: "week", back: 1 }, 1204, "Tide")).toBe(
      "You played your tracks 1,204 times last week, mostly Tide.",
    );
    expect(digestSentence({ kind: "all", back: 0 }, 9, "Tide")).toBe("You have played your tracks 9 times so far, mostly Tide.");
  });
  it("falls back to the empty line with no plays", () => {
    expect(digestSentence({ kind: "week", back: 0 }, 0, null)).toBe("No plays yet this week.");
    expect(digestSentence({ kind: "all", back: 0 }, 0, null)).toBe("No plays counted yet.");
  });
});

describe("emptyPeriodLine", () => {
  it("says yet for the current period and not for one stepped back to", () => {
    expect(emptyPeriodLine({ kind: "today", back: 0 })).toBe("No plays yet today.");
    expect(emptyPeriodLine({ kind: "week", back: 0 })).toBe("No plays yet this week.");
    expect(emptyPeriodLine({ kind: "month", back: 1 })).toBe("No plays last month.");
  });
});

describe("lastPlayedLabel", () => {
  it("is relative for a week and a date after", () => {
    expect(lastPlayedLabel(null, TODAY)).toBe("–");
    expect(lastPlayedLabel("2026-10-15", TODAY)).toBe("Today");
    expect(lastPlayedLabel("2026-10-14", TODAY)).toBe("Yesterday");
    expect(lastPlayedLabel("2026-10-10", TODAY)).toBe("5 days ago");
    expect(lastPlayedLabel("2026-10-08", TODAY)).toBe("8 Oct");
    expect(lastPlayedLabel("2025-12-30", TODAY)).toBe("30 Dec 2025");
  });
});

describe("counting and numbers", () => {
  it("says what is counted, and on this Mac only", () => {
    expect(countingLine(true, "2026-10-15", TODAY)).toBe("Counted on this Mac since 15 Oct.");
    expect(countingLine(true, "2025-11-02", TODAY)).toBe("Counted on this Mac since 2 Nov 2025.");
    expect(countingLine(false, null, TODAY)).toBe("Play counting is off.");
    expect(countingLine(true, null, TODAY)).toBe("Counting plays on this Mac.");
  });
  it("formats counts", () => {
    expect(formatCount(1204)).toBe("1,204");
    expect(playsCount(1)).toBe("1 play");
    expect(playsCount(1204)).toBe("1,204 plays");
    expect(shortDay("2026-03-05", TODAY)).toBe("5 Mar");
  });
});
