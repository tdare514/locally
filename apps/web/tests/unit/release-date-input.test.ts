import { describe, expect, it } from "vitest";
import {
  atPrecision,
  dateFromPickerValue,
  fieldsFromText,
  initialReleaseDateText,
  pickerValue,
  releaseDateTextBlocks,
  today,
} from "../../src/lib/release-date-input";

describe("release date field text", () => {
  it("reads a typed date into year and releaseDate", () => {
    expect(fieldsFromText("2024")).toEqual({ year: "2024" });
    expect(fieldsFromText("17 May 2024")).toEqual({ year: "2024", releaseDate: "2024-05-17" });
    expect(fieldsFromText("")).toBeNull();
    expect(fieldsFromText("soon")).toBeNull();
  });

  it("blocks only text that is something but not a date", () => {
    expect(releaseDateTextBlocks("")).toBe(false);
    expect(releaseDateTextBlocks("  ")).toBe(false);
    expect(releaseDateTextBlocks("2024")).toBe(false);
    expect(releaseDateTextBlocks("31/02/2024")).toBe(true);
    expect(releaseDateTextBlocks("soon")).toBe(true);
  });

  it("shows a year that is not four digits as it is", () => {
    expect(initialReleaseDateText("199x", undefined)).toBe("199x");
    expect(initialReleaseDateText("2024", undefined, "en-GB")).toBe("2024");
    expect(initialReleaseDateText("2024", "2024-05-17", "en-GB")).toBe("17 May 2024");
    expect(initialReleaseDateText(null, undefined)).toBe("");
  });
});

describe("date picker values", () => {
  it("cuts and fills a date to a precision", () => {
    const day = { year: 2024, month: 5, day: 17 };
    expect(pickerValue(day, "year")).toBe("2024");
    expect(pickerValue(day, "month")).toBe("2024-05");
    expect(pickerValue(day, "day")).toBe("2024-05-17");
    expect(pickerValue({ year: 2024 }, "day")).toBe("2024-01-01");
    expect(atPrecision({ year: 2024, month: 5 }, "year")).toEqual({ year: 2024 });
  });

  it("reads a native input value only at its own precision", () => {
    expect(dateFromPickerValue("2024-05", "month")).toEqual({ year: 2024, month: 5 });
    expect(dateFromPickerValue("2024-05", "day")).toBeNull();
    expect(dateFromPickerValue("", "year")).toBeNull();
    expect(dateFromPickerValue("20", "year")).toBeNull();
  });

  it("today is a full local date", () => {
    expect(today(new Date(2026, 9, 22))).toEqual({ year: 2026, month: 10, day: 22 });
  });
});
