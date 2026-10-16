"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ChevronRightIcon } from "../Icons";

/** The Stats page's controls (#145), on the #155 button set. */

/** Sets custom properties (`--n`, `--i`) from React. */
function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

/** The set's toggle: words, and a dot that slides under the chosen one. Two options is exactly
 * `.btn-seg`; more adds `.st-seg`, which spreads the dot over `--n` columns and puts it at `--i`
 * (the set's toggle is two-option only, see the Stats block in globals.css). */
export function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      role="group"
      aria-label={label}
      className={`btn-seg ${options.length > 2 ? "st-seg" : ""} ${className}`}
      style={options.length > 2 ? vars({ "--n": options.length, "--i": index }) : undefined}
    >
      <span aria-hidden className="btn-seg-dot">
        <span />
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="btn-seg-opt"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The glass toggle (`.seg-glass`, globals.css): the chosen option sits on the Save button's hover
 * glass, which slides to the next one. Any number of options. When they are wider than the room
 * (a phone) the row scrolls sideways and keeps the chosen one in view. */
export function GlassToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chosen = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!chosen || !row.current) return;
    // Scroll the row itself, never the page: scrollIntoView would move every scrolling ancestor too.
    const box = row.current;
    const left = chosen.offsetLeft;
    const right = left + chosen.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left - 8;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8;
  }, [value]);
  return (
    <div ref={row} className="st-scroll-x">
      <div role="group" aria-label={label} className="seg-glass" style={vars({ "--n": options.length, "--i": index })}>
        <span aria-hidden className="seg-glass-thumb" />
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className="seg-glass-opt"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Steps the chosen period back and forward: earlier is the left chevron. A period stepped back to
 * sits on the same glass as the chosen period. All time has nothing to step through, so it only
 * says what it covers. When the Mac no longer keeps days that far back the left chevron is off,
 * with a tooltip that says why. */
export function PeriodStepper({
  noun,
  title,
  detail,
  stepped,
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  /** "day", "week", "month" or "year"; empty for all time, which has no steps. */
  noun: string;
  title: string;
  detail: string;
  /** A period stepped back to wears the glass. */
  stepped: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <div role="group" aria-label="Step through time" className="flex items-center gap-1">
      {noun && (
        // A disabled button gets no hover, so the tooltip sits on a wrapper.
        <span title={canBack ? undefined : "Kept for 400 days"}>
          <button type="button" className="btn-icon" aria-label={`Previous ${noun}`} disabled={!canBack} onClick={onBack}>
            <ChevronRightIcon className="h-[18px] w-[18px] rotate-180" />
          </button>
        </span>
      )}
      <p
        aria-live="polite"
        data-on={stepped}
        className="seg-glass-face relative isolate min-w-[9.5rem] rounded-full px-4 py-1.5 text-center"
      >
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        <span className="block text-xs leading-tight text-text-muted">{detail}</span>
      </p>
      {noun && (
        <button type="button" className="btn-icon" aria-label={`Next ${noun}`} disabled={!canForward} onClick={onForward}>
          <ChevronRightIcon className="h-[18px] w-[18px]" />
        </button>
      )}
    </div>
  );
}

/** A quiet menu: a native select, so it keeps keyboard and screen-reader behaviour for free. */
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="glass-fake relative isolate inline-flex items-center gap-2 rounded-full py-2 pl-4 pr-9 text-sm focus-within:outline focus-within:outline-[1.5px] focus-within:outline-offset-2 focus-within:outline-white/85">
      <span className="text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent font-semibold text-text outline-none [color-scheme:dark]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRightIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-text-muted" />
    </label>
  );
}
