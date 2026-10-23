import { describe, expect, it } from "vitest";
import {
  formatReleaseDate,
  isReleaseDateValue,
  makeReleaseDate,
  parseIsoReleaseDate,
  parseReleaseDateText,
  releaseDateFields,
  releaseDateFromTag,
  releaseDateIso,
  releaseDateValue,
  releaseYear,
  storedReleaseDate,
} from "../../src/shared/releaseDate";

describe("makeReleaseDate / parseIsoReleaseDate / isReleaseDateValue", () => {
  it("knows leap years", () => {
    expect(makeReleaseDate(2024, 2, 29)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(makeReleaseDate(2023, 2, 29)).toBeNull();
    expect(makeReleaseDate(1900, 2, 29)).toBeNull();
    expect(makeReleaseDate(2000, 2, 29)).not.toBeNull();
    expect(parseIsoReleaseDate("2023-02-29")).toBeNull();
  });

  it("refuses a day without a month and out-of-range parts", () => {
    expect(makeReleaseDate(2024, undefined, 3)).toBeNull();
    expect(makeReleaseDate(2024, 13)).toBeNull();
    expect(makeReleaseDate(2024, 4, 31)).toBeNull();
    expect(makeReleaseDate(10000)).toBeNull();
  });

  it("accepts only YYYY-MM and YYYY-MM-DD real dates as a releaseDate value", () => {
    expect(isReleaseDateValue("2024-05")).toBe(true);
    expect(isReleaseDateValue("2024-05-17")).toBe(true);
    expect(isReleaseDateValue("2024-02-29")).toBe(true);
    for (const bad of ["2024", "2024-13", "2023-02-29", "2024-5-17", "2024-05-17T07:00:00Z", " 2024-05", "", "soon"]) {
      expect(isReleaseDateValue(bad), bad).toBe(false);
    }
  });
});

describe("releaseDateFromTag", () => {
  it("reads the leading date of a tag value", () => {
    expect(releaseDateFromTag("2024-05-17T07:00:00Z")).toEqual({ year: 2024, month: 5, day: 17 });
    expect(releaseDateFromTag("2024-05-17")).toEqual({ year: 2024, month: 5, day: 17 });
    expect(releaseDateFromTag("2024-05")).toEqual({ year: 2024, month: 5 });
    expect(releaseDateFromTag("2024")).toEqual({ year: 2024 });
  });

  it("falls back to the shorter prefix when the longer is not a real date", () => {
    expect(releaseDateFromTag("2024-13-40")).toEqual({ year: 2024 });
    expect(releaseDateFromTag("2024-02-30")).toEqual({ year: 2024, month: 2 });
  });

  it("gives null with no leading four-digit year", () => {
    expect(releaseDateFromTag("")).toBeNull();
    expect(releaseDateFromTag("May 2024")).toBeNull();
    expect(releaseDateFromTag("20245")).toBeNull();
  });
});

describe("storedReleaseDate", () => {
  it("uses the releaseDate when it agrees with the year", () => {
    expect(storedReleaseDate("2024", "2024-05-17")).toEqual({ year: 2024, month: 5, day: 17 });
    expect(storedReleaseDate("2024", "2024-05")).toEqual({ year: 2024, month: 5 });
  });

  it("falls back to the year when the releaseDate is bad, disagrees, or is a bare year", () => {
    expect(storedReleaseDate("2024", "2024-13")).toEqual({ year: 2024 });
    expect(storedReleaseDate("2024", "2023-05-01")).toEqual({ year: 2024 });
    expect(storedReleaseDate("2024", "2024")).toEqual({ year: 2024 });
    expect(storedReleaseDate("2024", 42)).toEqual({ year: 2024 });
    expect(storedReleaseDate("2024", undefined)).toEqual({ year: 2024 });
  });

  it("gives null without a four-digit year", () => {
    expect(storedReleaseDate(null, "2024-05-17")).toBeNull();
    expect(storedReleaseDate("24", "2024-05-17")).toBeNull();
  });
});

describe("string forms and fields", () => {
  it("writes year, TDRC and the releaseDate key", () => {
    const day = { year: 2024, month: 5, day: 17 };
    expect(releaseYear(day)).toBe("2024");
    expect(releaseDateIso(day)).toBe("2024-05-17");
    expect(releaseDateIso({ year: 2024, month: 5 })).toBe("2024-05");
    expect(releaseDateIso({ year: 987 })).toBe("0987");
    expect(releaseDateValue({ year: 2024 })).toBeUndefined();
    expect(releaseDateValue({ year: 2024, month: 5 })).toBe("2024-05");
  });

  it("releaseDateFields sets year and releaseDate together, omitting the key at year precision", () => {
    expect(releaseDateFields(null)).toEqual({ year: null });
    const yearOnly = releaseDateFields({ year: 2024 });
    expect(yearOnly).toEqual({ year: "2024" });
    expect("releaseDate" in yearOnly).toBe(false);
    expect(releaseDateFields({ year: 2024, month: 5, day: 17 })).toEqual({ year: "2024", releaseDate: "2024-05-17" });
  });
});

describe("formatReleaseDate", () => {
  it("formats en-GB", () => {
    expect(formatReleaseDate({ year: 2024, month: 5, day: 17 }, "en-GB")).toBe("17 May 2024");
    expect(formatReleaseDate({ year: 2024, month: 5 }, "en-GB")).toBe("May 2024");
    expect(formatReleaseDate({ year: 2024 }, "en-GB")).toBe("2024");
  });

  it("formats en-US", () => {
    expect(formatReleaseDate({ year: 2024, month: 5, day: 17 }, "en-US")).toBe("May 17, 2024");
  });
});

describe("parseReleaseDateText", () => {
  const date = (year: number, month?: number, day?: number) => ({ kind: "date", date: { year, month, day } });
  const clean = (e: ReturnType<typeof parseReleaseDateText>) =>
    e.kind === "date" ? { kind: "date", date: { year: e.date.year, month: e.date.month, day: e.date.day } } : e;

  it("reads a year and ISO dates", () => {
    expect(clean(parseReleaseDateText("2024", "en-GB"))).toEqual(date(2024));
    expect(clean(parseReleaseDateText("2024-05-17", "en-GB"))).toEqual(date(2024, 5, 17));
  });

  it("reads numeric dates in the locale's order", () => {
    expect(clean(parseReleaseDateText("17/05/2024", "en-GB"))).toEqual(date(2024, 5, 17));
    expect(clean(parseReleaseDateText("05/17/2024", "en-US"))).toEqual(date(2024, 5, 17));
  });

  it("reads month names", () => {
    expect(clean(parseReleaseDateText("17 May 2024", "en-GB"))).toEqual(date(2024, 5, 17));
    expect(clean(parseReleaseDateText("May 17, 2024", "en-US"))).toEqual(date(2024, 5, 17));
    expect(clean(parseReleaseDateText("May 2024", "en-GB"))).toEqual(date(2024, 5));
  });

  it("tells impossible, unreadable and empty apart", () => {
    expect(parseReleaseDateText("31/02/2024", "en-GB").kind).toBe("impossible");
    expect(parseReleaseDateText("soon", "en-GB").kind).toBe("unreadable");
    expect(parseReleaseDateText("", "en-GB").kind).toBe("empty");
    expect(parseReleaseDateText("   ", "en-GB").kind).toBe("empty");
  });

  it.each(["ja-JP", "de-DE", "fr-FR", "en-GB", "en-US"])("reads back what formatReleaseDate prints for %s", (locale) => {
    for (const d of [
      { year: 2024, month: 5, day: 17 },
      { year: 2024, month: 5 },
      { year: 2024, month: 2, day: 29 },
      { year: 2024 },
    ]) {
      const printed = formatReleaseDate(d, locale);
      const read = parseReleaseDateText(printed, locale);
      expect(read.kind, `${locale}: ${printed}`).toBe("date");
      if (read.kind === "date") {
        expect(releaseDateIso(read.date), `${locale}: ${printed}`).toBe(releaseDateIso(d));
      }
    }
  });

  it("reads back what a non-Latin-digit locale prints, at every precision", () => {
    for (const locale of ["ar-EG", "hi-IN-u-nu-deva", "fa-IR"]) {
      for (const d of [{ year: 2024 }, { year: 2024, month: 5 }, { year: 2024, month: 5, day: 17 }]) {
        const printed = formatReleaseDate(d, locale);
        const read = parseReleaseDateText(printed, locale);
        expect(read.kind, `${locale}: ${printed}`).toBe("date");
        if (read.kind === "date") expect(releaseDateIso(read.date), `${locale}: ${printed}`).toBe(releaseDateIso(d));
      }
    }
  });

  it("reads typed non-Latin digits and ignores bidi marks", () => {
    const read = parseReleaseDateText("\u200f\u0662\u0660\u0662\u0664-\u0660\u0665-\u0661\u0667");
    expect(read.kind === "date" && releaseDateIso(read.date)).toBe("2024-05-17");
  });
});
