/**
 * The Release date field's text, read the one way everywhere (#221): the release page, the import record and
 * bulk edit. Pure; the parsing itself is `src/shared/releaseDate.ts`.
 */
import {
  formatReleaseDate,
  makeReleaseDate,
  parseIsoReleaseDate,
  parseReleaseDateText,
  releaseDateFields,
  releaseDateIso,
  releaseDateText,
  type ReleaseDate,
} from "../shared/releaseDate";

/** The stored `year` and `releaseDate` as sent: `year` always, `releaseDate` only at month or day precision. */
export type ReleaseDateFields = { year: string; releaseDate?: string };

/** The date the text is, or null when it is empty or not a date. */
export function dateFromText(text: string, locale?: string): ReleaseDate | null {
  const entry = parseReleaseDateText(text, locale);
  return entry.kind === "date" ? entry.date : null;
}

/** True when the text is something but not a date we can save ("31/02/2024", "soon"). */
export function releaseDateTextBlocks(text: string, locale?: string): boolean {
  const kind = parseReleaseDateText(text, locale).kind;
  return kind === "impossible" || kind === "unreadable";
}

/** `year` (+ `releaseDate`) for a date typed in, or null for empty or unreadable text. */
export function fieldsFromText(text: string, locale?: string): ReleaseDateFields | null {
  const date = dateFromText(text, locale);
  if (!date) return null;
  const fields = releaseDateFields(date);
  return fields.releaseDate === undefined ? { year: fields.year as string } : { year: fields.year as string, releaseDate: fields.releaseDate };
}

/**
 * What the field shows for a stored release: its formatted date, or "" with none. A `year` that is not four
 * digits (an old synced value) is shown as it is, so it is never lost or blocks a save of something else.
 */
export function initialReleaseDateText(year: string | null | undefined, releaseDate: unknown, locale?: string): string {
  if (typeof year === "string" && year.trim() !== "" && !/^\d{4}$/.test(year)) return year;
  return releaseDateText(year, releaseDate, locale);
}

/** What the popover's native input holds for a date at a precision: "2024", "2024-05" or "2024-05-17". */
export type PickerPrecision = "year" | "month" | "day";

export function precisionOf(date: ReleaseDate): PickerPrecision {
  return date.day !== undefined ? "day" : date.month !== undefined ? "month" : "year";
}

/** The date cut or filled to `precision` (a missing month or day becomes January or the 1st). */
export function atPrecision(date: ReleaseDate, precision: PickerPrecision): ReleaseDate {
  if (precision === "year") return { year: date.year };
  const month = date.month ?? 1;
  if (precision === "month") return { year: date.year, month };
  return makeReleaseDate(date.year, month, date.day ?? 1) ?? { year: date.year, month };
}

/** The native input's value for `date` at `precision`. */
export function pickerValue(date: ReleaseDate, precision: PickerPrecision): string {
  return releaseDateIso(atPrecision(date, precision));
}

/** The date a native input's value is at `precision`, or null (an empty or half-typed input). */
export function dateFromPickerValue(value: string, precision: PickerPrecision): ReleaseDate | null {
  const date = parseIsoReleaseDate(value);
  return date && precisionOf(date) === precision ? date : null;
}

/** Today (the local calendar day) as a full date. */
export function today(now: Date = new Date()): ReleaseDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** The text a chosen date writes into the field. */
export function textFromDate(date: ReleaseDate, locale?: string): string {
  return formatReleaseDate(date, locale);
}

export interface PopoverBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the date popover sits: its left edge on the field's left edge, shifted sideways (`dx`, px) to stay inside
 * `bounds` (the dialog and viewport), and above (`up`) or below the field, flipped when the preferred side has no room.
 */
export function placePopover(
  anchor: PopoverBox,
  size: { width: number; height: number },
  bounds: PopoverBox,
  preferUp: boolean,
  gap = 4,
  margin = 8,
): { dx: number; up: boolean } {
  const maxLeft = bounds.right - margin - size.width;
  const minLeft = bounds.left + margin;
  const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(anchor.left, minLeft), maxLeft);
  const need = size.height + gap + margin;
  const fitsAbove = anchor.top - bounds.top >= need;
  const fitsBelow = bounds.bottom - anchor.bottom >= need;
  let up = preferUp;
  if (preferUp && !fitsAbove && fitsBelow) up = false;
  else if (!preferUp && !fitsBelow && fitsAbove) up = true;
  else if (!fitsAbove && !fitsBelow) up = anchor.top - bounds.top > bounds.bottom - anchor.bottom;
  return { dx: left - anchor.left, up };
}
