"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IS_DEMO } from "../lib/demo";
import {
  atPrecision,
  dateFromPickerValue,
  dateFromText,
  pickerValue,
  placePopover,
  precisionOf,
  textFromDate,
  today,
  type PickerPrecision,
} from "../lib/release-date-input";
import { parseReleaseDateText, releaseDateMessage, type ReleaseDate } from "../shared/releaseDate";
import { CalendarIcon } from "./Icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** "inline" is the release page and import record's quiet field; "form" is bulk edit's labelled box. */
  variant?: "inline" | "form";
  disabled?: boolean;
  /** Extra classes for the input (the import record's empty-field underline). */
  inputExtraClassName?: string;
  /** The blank's length for the inline variant. */
  minWidth?: string;
}

const FOCUSABLE = "input, button, a, textarea, select, [tabindex]";
const LABEL = "Release date";

const PRECISIONS: { value: PickerPrecision; label: string }[] = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "day", label: "Day" },
];

const INPUT_CLASS: Record<"inline" | "form", string> = {
  inline:
    "rounded-md bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent",
  form: "min-w-0 flex-1 rounded-md bg-elevated px-4 py-3 text-sm text-text outline-none placeholder:text-text-muted/60 focus:ring-2 focus:ring-accent disabled:opacity-50",
};

/**
 * The Release date field (#221): one text input that reads "2024", "May 2024" or "17 May 2024", and a
 * calendar button that opens a small glass popover (Year / Month / Day, then Done or Clear date). A readable
 * date is rewritten in the locale's long form on blur. The message for unreadable text shows under the
 * field only while it is not focused.
 */
export default function ReleaseDateField({
  value,
  onChange,
  placeholder,
  variant = "inline",
  disabled,
  inputExtraClassName = "",
  minWidth = "min-w-[4ch]",
}: Props) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const messageId = useId();
  const dialogId = useId();

  const message = releaseDateMessage(parseReleaseDateText(value));
  const showMessage = message !== null && !focused;
  const readOnly = IS_DEMO;

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>("[data-date-popover] button[aria-pressed='true']")?.focus();
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target || wrapRef.current?.contains(target)) return;
      setOpen(false);
      // Focus returns to the button unless the click landed on something that takes focus itself.
      if (!target.closest(FOCUSABLE)) buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleBlur() {
    setFocused(false);
    const date = dateFromText(value);
    if (!date) return;
    const text = textFromDate(date);
    if (text !== value) onChange(text);
  }

  const input = (
    <input
      id={inputId}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      aria-invalid={message !== null || undefined}
      aria-describedby={message !== null ? messageId : undefined}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
      onChange={(e) => onChange(e.target.value)}
      className={`${variant === "inline" ? `field-sizing-content ${minWidth}` : ""} ${INPUT_CLASS[variant]} ${inputExtraClassName}`}
    />
  );

  const button = !readOnly && (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-label="Choose a date"
      title="Choose a date"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? dialogId : undefined}
      onClick={() => (open ? close() : setOpen(true))}
      className={`flex size-6 shrink-0 cursor-pointer items-center justify-center self-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${
        variant === "inline" ? "text-white/70 hover:bg-white/[0.07] hover:text-text" : "text-text-muted hover:text-text"
      }`}
    >
      <CalendarIcon className="size-4" />
    </button>
  );

  return (
    <div
      ref={wrapRef}
      className={`relative flex min-w-0 flex-col ${variant === "form" ? "gap-2 text-sm" : "gap-1"}`}
      onBlur={(e) => {
        // Focus moving out of the whole field closes the popover; where focus went is left alone.
        const next = e.relatedTarget as Node | null;
        if (open && next && !e.currentTarget.contains(next)) setOpen(false);
      }}
    >
      {variant === "inline" ? (
        <div className="flex items-baseline gap-1.5">
          <label htmlFor={inputId} className="text-white/70">
            {LABEL}
          </label>
          {input}
          {button}
        </div>
      ) : (
        <>
          <label htmlFor={inputId} className="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
            {LABEL}
          </label>
          <div className="flex items-center gap-1">
            {input}
            {button}
          </div>
        </>
      )}
      {message !== null &&
        (showMessage ? (
          <p key="visible" id={messageId} role="alert" className="text-xs text-danger">
            {message}
          </p>
        ) : (
          <p key="hidden" id={messageId} className="sr-only">
            {message}
          </p>
        ))}
      {open && (
        <DatePopover
          id={dialogId}
          start={dateFromText(value)}
          openUp={variant === "form"}
          onDone={(date) => {
            onChange(textFromDate(date));
            close();
          }}
          onClear={() => {
            onChange("");
            close();
          }}
          onEscape={close}
        />
      )}
    </div>
  );
}

function DatePopover({
  id,
  start,
  openUp,
  onDone,
  onClear,
  onEscape,
}: {
  id: string;
  start: ReleaseDate | null;
  /** Bulk edit's dialog: above the field if there is room (else below), kept inside the dialog. */
  openUp: boolean;
  onDone: (date: ReleaseDate) => void;
  onClear: () => void;
  onEscape: () => void;
}) {
  // The typed date and its precision, else today at Day.
  const [precision, setPrecision] = useState<PickerPrecision>(() => (start ? precisionOf(start) : "day"));
  // The last whole date the input held, so switching precision keeps the parts the person chose.
  const [base, setBase] = useState<ReleaseDate>(() => start ?? today());
  const [raw, setRaw] = useState(() => pickerValue(start ?? today(), start ? precisionOf(start) : "day"));
  const chosen = dateFromPickerValue(raw, precision);
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ dx: 0, up: openUp });

  // Measured once it is open: left on the field's left edge, clamped to the dialog (or viewport), flipped if cramped.
  useLayoutEffect(() => {
    const pop = popRef.current;
    const wrap = pop?.parentElement;
    if (!pop || !wrap) return;
    const dialog = wrap.closest("dialog")?.getBoundingClientRect();
    const view = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };
    const bounds = dialog
      ? {
          left: Math.max(dialog.left, view.left),
          top: Math.max(dialog.top, view.top),
          right: Math.min(dialog.right, view.right),
          bottom: Math.min(dialog.bottom, view.bottom),
        }
      : view;
    const next = placePopover(wrap.getBoundingClientRect(), { width: pop.offsetWidth, height: pop.offsetHeight }, bounds, openUp);
    setPlace((prev) => (prev.dx === next.dx && prev.up === next.up ? prev : next));
  }, [openUp]);

  function choose(next: PickerPrecision) {
    setPrecision(next);
    setRaw(pickerValue(base, next));
  }

  function change(next: string) {
    setRaw(next);
    const date = dateFromPickerValue(next, precision);
    if (date) setBase(atPrecision({ ...base, ...date }, "day"));
  }

  function done() {
    if (chosen) onDone(chosen);
  }

  const inputClass =
    "w-full rounded-md bg-white/10 px-2 py-1 text-sm text-text outline-none [color-scheme:dark] focus:ring-2 focus:ring-accent";

  return (
    <div
      ref={popRef}
      id={id}
      style={place.dx ? { translate: `${place.dx}px` } : undefined}
      data-date-popover
      role="dialog"
      aria-label="Choose a release date"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          // Enter in the picker applies it; it never submits the form it sits in.
          e.preventDefault();
          done();
        }
      }}
      className={`playlist-pop glass-fake glass-frost absolute z-30 isolate flex w-64 max-w-[80vw] flex-col gap-3 rounded-2xl p-3 ${
        place.up ? "bottom-full left-0 mb-1" : "left-0 top-full mt-1"
      }`}
    >
      <div role="group" aria-label="Precision" className="btn-seg btn-seg-3 self-start">
        <span aria-hidden className="btn-seg-dot">
          <span />
        </span>
        {PRECISIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={precision === p.value}
            onClick={() => choose(p.value)}
            className="btn-seg-opt"
          >
            {p.label}
          </button>
        ))}
      </div>
      {precision === "year" && (
        <input
          type="number"
          min={1000}
          max={9999}
          step={1}
          aria-label="Year"
          value={raw}
          onChange={(e) => change(e.target.value)}
          className={inputClass}
        />
      )}
      {precision === "month" && (
        <input type="month" aria-label="Month" value={raw} onChange={(e) => change(e.target.value)} className={inputClass} />
      )}
      {precision === "day" && (
        <input type="date" aria-label="Day" value={raw} onChange={(e) => change(e.target.value)} className={inputClass} />
      )}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onClear} className="btn-ink">
          Clear date
        </button>
        <button type="button" onClick={done} disabled={!chosen} className="btn-ink">
          Done
        </button>
      </div>
    </div>
  );
}
