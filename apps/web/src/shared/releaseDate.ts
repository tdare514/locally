/**
 * A release date at year, month or day precision (#221): "2024", "2024-05" or "2024-05-17".
 * Every read and write of a date goes through here, so `year` and `releaseDate` cannot drift.
 * Mirrors the iPhone's `ReleaseDate.swift` and `ReleaseDateText.swift`. Pure: no node imports.
 */
export interface ReleaseDate {
  /** 0..9999, written as four digits. */
  year: number;
  /** 1..12. */
  month?: number;
  /** A real day for its month and year (leap years); never set without a month. */
  day?: number;
}

function daysIn(month: number, year: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** The date for these parts, or null when they are not a real date. */
export function makeReleaseDate(year: number, month?: number, day?: number): ReleaseDate | null {
  if (!Number.isInteger(year) || year < 0 || year > 9999) return null;
  if (month === undefined) return day === undefined ? { year } : null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (day === undefined) return { year, month };
  if (!Number.isInteger(day) || day < 1 || day > daysIn(month, year)) return null;
  return { year, month, day };
}

const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Exactly `YYYY`, `YYYY-MM` or `YYYY-MM-DD` that is a real date (surrounding whitespace is trimmed). */
export function parseIsoReleaseDate(text: string): ReleaseDate | null {
  const m = ISO.exec(text.trim());
  if (!m) return null;
  return makeReleaseDate(Number(m[1]), m[2] === undefined ? undefined : Number(m[2]), m[3] === undefined ? undefined : Number(m[3]));
}

/** True for a `releaseDate` value the record may carry: `YYYY-MM` or `YYYY-MM-DD`, a real date. */
export function isReleaseDateValue(text: string): boolean {
  const date = parseIsoReleaseDate(text);
  return date !== null && date.month !== undefined && text === releaseDateIso(date);
}

/**
 * The date at the start of a tag value: a leading `YYYY-MM-DD`, `YYYY-MM` or `YYYY` followed by the end or a
 * non-digit ("2024-05-17T07:00:00Z" gives 2024-05-17). When the longer prefix is not a real date the shorter
 * one is tried ("2024-13-40" gives 2024). Null when there is no leading four-digit year.
 */
export function releaseDateFromTag(raw: string): ReleaseDate | null {
  const text = raw.trim();
  for (const length of [10, 7, 4]) {
    if (text.length < length) continue;
    if (text.length > length && /\d/.test(text[length])) continue;
    const prefix = text.slice(0, length);
    const date = parseIsoReleaseDate(prefix);
    if (date && releaseDateIso(date).length === length) return date;
  }
  return null;
}

/** The date a stored release holds: `year` must be four digits; `releaseDate` is used only when it is at month or
 * day precision and its year equals `year`, otherwise the year alone. */
export function storedReleaseDate(year: string | null | undefined, releaseDate: unknown): ReleaseDate | null {
  if (typeof year !== "string" || !/^\d{4}$/.test(year)) return null;
  if (typeof releaseDate === "string" && isReleaseDateValue(releaseDate)) {
    const precise = parseIsoReleaseDate(releaseDate);
    if (precise && precise.year === Number(year)) return precise;
  }
  return { year: Number(year) };
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** "2024". */
export function releaseYear(date: ReleaseDate): string {
  return pad(date.year, 4);
}

/** "2024", "2024-05" or "2024-05-17": the TDRC value. */
export function releaseDateIso(date: ReleaseDate): string {
  let s = pad(date.year, 4);
  if (date.month !== undefined) s += `-${pad(date.month, 2)}`;
  if (date.day !== undefined) s += `-${pad(date.day, 2)}`;
  return s;
}

/** The `releaseDate` key: "2024-05" or "2024-05-17"; undefined at year precision. */
export function releaseDateValue(date: ReleaseDate): string | undefined {
  return date.month === undefined ? undefined : releaseDateIso(date);
}

/** The two stored fields set together from one value: `year` and, when more precise, `releaseDate`. */
export function releaseDateFields(date: ReleaseDate | null): { year: string | null; releaseDate?: string } {
  if (!date) return { year: null };
  const releaseDate = releaseDateValue(date);
  return releaseDate === undefined ? { year: releaseYear(date) } : { year: releaseYear(date), releaseDate };
}

function utcDate(date: ReleaseDate): Date {
  const d = new Date(Date.UTC(2000, (date.month ?? 1) - 1, date.day ?? 1));
  d.setUTCFullYear(date.year);
  return d;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, withDay: boolean): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${withDay}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      calendar: "gregory",
      year: "numeric",
      month: "long",
      ...(withDay ? { day: "numeric" } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** en-GB "17 May 2024", "May 2024", "2024"; en-US "May 17, 2024", "May 2024", "2024". Gregorian, UTC. */
export function formatReleaseDate(date: ReleaseDate, locale?: string): string {
  if (date.month === undefined) return releaseYear(date);
  return formatter(locale, date.day !== undefined).format(utcDate(date));
}

/** What a typed release date came to. */
export type ReleaseDateEntry =
  | { kind: "empty" }
  | { kind: "date"; date: ReleaseDate }
  /** Has a date's shape but is not a real date: 31/02/2024, 2024-13. */
  | { kind: "impossible" }
  /** Not a date we read: "soon", "2", "17 Mayo 2024". */
  | { kind: "unreadable" };

export const RELEASE_DATE_IMPOSSIBLE = "That date doesn't exist";

/** "Enter a year, or a date like 17 May 2024" (the example follows the locale). */
export function releaseDateUnreadableMessage(locale?: string): string {
  return `Enter a year, or a date like ${formatReleaseDate({ year: 2024, month: 5, day: 17 }, locale)}`;
}

/** The line under the field, or null when the text is empty or a date. */
export function releaseDateMessage(entry: ReleaseDateEntry, locale?: string): string | null {
  if (entry.kind === "impossible") return RELEASE_DATE_IMPOSSIBLE;
  if (entry.kind === "unreadable") return releaseDateUnreadableMessage(locale);
  return null;
}

/** Every whitespace run becomes one plain space, ends trimmed, then case and accents folded. */
function normalized(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** What `formatReleaseDate` prints for `locale` reads back ("2024年5月17日", "17 мая 2024 г."): the four-digit year in
 * the text, then every month and day of it, until one prints the very same text (up to spaces, case and accents). */
function formattedDate(text: string, locale: string | undefined): ReleaseDate | null {
  const years = text.match(/\d{4}/g);
  if (!years || years.length !== 1) return null;
  const year = Number(years[0]);
  const wanted = normalized(text);
  for (let month = 1; month <= 12; month++) {
    if (normalized(formatReleaseDate({ year, month }, locale)) === wanted) return { year, month };
    for (let day = 1; day <= daysIn(month, year); day++) {
      if (normalized(formatReleaseDate({ year, month, day }, locale)) === wanted) return { year, month, day };
    }
  }
  return null;
}

/** True when the locale's numeric date puts the day before the month (en-GB), false for en-US. */
function dayFirst(locale: string | undefined): boolean {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(new Date(Date.UTC(2024, 4, 17)))
    .map((p) => p.type);
  const d = parts.indexOf("day");
  const m = parts.indexOf("month");
  return d < 0 || m < 0 ? true : d < m;
}

/** 1..12 for a full or short month name in the locale (or English), ignoring case, accents and a trailing dot;
 * null if none or more than one fits. */
function monthNamed(name: string, locale: string | undefined): number | null {
  const wanted = normalized(name);
  const found = new Set<number>();
  for (const loc of [locale, "en"]) {
    for (const style of ["long", "short"] as const) {
      const f = new Intl.DateTimeFormat(loc, { timeZone: "UTC", month: style });
      for (let m = 1; m <= 12; m++) {
        const symbol = normalized(f.format(new Date(Date.UTC(2024, m - 1, 1)))).replace(/\.$/, "");
        if (symbol === wanted) found.add(m);
      }
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

type Token = { number: string } | { word: string };

/** Digit runs and letter runs; null when anything but a separator is in the text. */
function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /(\d+)|(\p{L}+)|([\s/.,-]+)|(.)/gu;
  for (const m of text.matchAll(re)) {
    if (m[4] !== undefined) return null;
    if (m[1] !== undefined) tokens.push({ number: m[1] });
    else if (m[2] !== undefined) tokens.push({ word: m[2] });
  }
  return tokens;
}

/** Builds the date from digit runs. A day or month of more than two digits is not a date's shape. */
function entry(year: string, month?: string, day?: string): ReleaseDateEntry {
  if (year.length !== 4) return { kind: "unreadable" };
  if ((month !== undefined && month.length > 2) || (day !== undefined && day.length > 2)) return { kind: "unreadable" };
  const date = makeReleaseDate(Number(year), month === undefined ? undefined : Number(month), day === undefined ? undefined : Number(day));
  return date ? { kind: "date", date } : { kind: "impossible" };
}

/**
 * Reads what a person types into the release date field: "2024", "2024-05", "05/2024", "May 2024", "2024-05-17",
 * "17/05/2024" (the locale's order), "17 May 2024", "May 17, 2024", or the locale's own formatted date. Checked by
 * hand against `makeReleaseDate`, never through a lenient `Date` parse (which rolls 31 Feb into March).
 */
export function parseReleaseDateText(text: string, locale?: string): ReleaseDateEntry {
  let trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const formatted = formattedDate(trimmed, locale);
  if (formatted) return { kind: "date", date: formatted };
  // "Sept." and "17 May 2024." end in a dot that means nothing.
  if (trimmed.endsWith(".")) trimmed = trimmed.slice(0, -1);
  if (!/^[\p{L}\d]/u.test(trimmed) || !/[\p{L}\d]$/u.test(trimmed)) return { kind: "unreadable" };
  const tokens = tokenize(trimmed);
  if (!tokens) return { kind: "unreadable" };

  const num = (t: Token) => ("number" in t ? t.number : null);
  const word = (t: Token) => ("word" in t ? t.word : null);

  if (tokens.length === 1) {
    const a = num(tokens[0]);
    return a !== null && a.length === 4 ? entry(a) : { kind: "unreadable" };
  }
  if (tokens.length === 2) {
    const [a, b] = [num(tokens[0]), num(tokens[1])];
    if (a !== null && b !== null) {
      if (a.length === 4 && b.length <= 2) return entry(a, b);
      if (b.length === 4 && a.length <= 2) return entry(b, a);
      return { kind: "unreadable" };
    }
    const name = word(tokens[0]);
    if (name !== null && b !== null && b.length === 4) {
      const month = monthNamed(name, locale);
      return month === null ? { kind: "unreadable" } : entry(b, String(month));
    }
    return { kind: "unreadable" };
  }
  if (tokens.length === 3) {
    const [a, b, c] = tokens.map(num);
    if (a !== null && b !== null && c !== null) {
      if (a.length === 4) return entry(a, b, c);
      if (c.length !== 4) return { kind: "unreadable" };
      return dayFirst(locale) ? entry(c, b, a) : entry(c, a, b);
    }
    // "17 May 2024" or "May 17, 2024".
    const name = word(tokens[1]) ?? word(tokens[0]);
    const day = word(tokens[1]) !== null ? a : b;
    if (name !== null && day !== null && c !== null && c.length === 4) {
      const month = monthNamed(name, locale);
      return month === null ? { kind: "unreadable" } : entry(c, String(month), day);
    }
    return { kind: "unreadable" };
  }
  return { kind: "unreadable" };
}

/** The text the field shows for a stored release: its date formatted, or "" with none. */
export function releaseDateText(year: string | null | undefined, releaseDate: unknown, locale?: string): string {
  const date = storedReleaseDate(year, releaseDate);
  return date ? formatReleaseDate(date, locale) : "";
}
