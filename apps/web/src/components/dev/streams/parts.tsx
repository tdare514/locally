"use client";

import { createContext, useContext, type CSSProperties } from "react";
import { ChevronRightIcon } from "../../Icons";
import {
  ago,
  fmt,
  maxBack,
  periodDetail,
  periodLabel,
  playsLabel,
  type Period,
  type Row,
} from "./sample-data";

/** Pieces shared by the parts of the #145 Stats page prototype. */

/** Cover id -> data URI. The server page builds it from the demo library's drawn SVGs. */
export const CoversContext = createContext<Record<string, string>>({});

/** Sets custom properties (`--st-i`, `--st-accent`) from React. */
export function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

/** "gold", "silver" or "bronze" for the first three ranks. */
export function medalFor(rank: number | null): "gold" | "silver" | "bronze" | undefined {
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : undefined;
}

// ---------------------------------------------------------------------------------------------
// Covers
// ---------------------------------------------------------------------------------------------

export function Cover({ coverId, className = "" }: { coverId: string; className?: string }) {
  const src = useContext(CoversContext)[coverId];
  if (!src) return <div className={`bg-elevated ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an inline data-URI SVG, nothing to optimise
    <img src={src} alt="" draggable={false} className={`object-cover ${className}`} />
  );
}

/** A small square (or round) cover for list rows. */
export function Thumb({ row, size }: { row: Pick<Row, "coverId" | "round">; size: number }) {
  return (
    <span
      className={`relative block shrink-0 overflow-hidden shadow-[0_8px_18px_-8px_rgb(0_0_0/0.7)] ${
        row.round ? "rounded-full" : "rounded-[4px]"
      }`}
      style={{ width: size, height: size }}
    >
      <Cover coverId={row.coverId} className="size-full" />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Controls (the #155 button set)
// ---------------------------------------------------------------------------------------------

/** The set's toggle: words, and a dot that slides under the chosen one. Two options is exactly
 * `.btn-seg`; more adds `.st-seg`, which spreads the dot over `--n` columns and puts it at `--i`
 * (the set's toggle is two-option only, see the Streams block in globals.css). */
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
 * glass, which slides to the next one. Any number of options. */
export function GlassToggle<T extends string>({
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
      className={`seg-glass ${className}`}
      style={vars({ "--n": options.length, "--i": index })}
    >
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
  );
}

const STEP_NOUN = { day: "day", week: "week", month: "month", year: "year", all: "" } as const;

/** Steps the chosen time frame back and forward: earlier is the left chevron. A period stepped back
 * to sits on the same glass as the chosen time frame. All time has nothing to step through, so it
 * only says what it covers. */
export function PeriodStepper({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  const noun = STEP_NOUN[period.kind];
  const step = (by: number) => onChange({ kind: period.kind, back: period.back + by });
  return (
    <div role="group" aria-label="Step through time" className="flex items-center gap-1">
      {noun && (
        <button
          type="button"
          className="btn-icon"
          aria-label={`Previous ${noun}`}
          disabled={period.back >= maxBack(period.kind)}
          onClick={() => step(1)}
        >
          <ChevronRightIcon className="h-[18px] w-[18px] rotate-180" />
        </button>
      )}
      <p
        aria-live="polite"
        data-on={period.back > 0}
        className="seg-glass-face relative isolate min-w-[9.5rem] rounded-full px-4 py-1.5 text-center"
      >
        <span className="block text-sm font-semibold leading-tight">{periodLabel(period)}</span>
        <span className="block text-xs leading-tight text-text-muted">{periodDetail(period)}</span>
      </p>
      {noun && (
        <button
          type="button"
          className="btn-icon"
          aria-label={`Next ${noun}`}
          disabled={period.back === 0}
          onClick={() => step(-1)}
        >
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
    <label className="glass-fake relative isolate inline-flex items-center gap-2 rounded-full py-2 pl-4 pr-9 text-sm">
      <span className="text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent font-semibold text-text outline-none [color-scheme:dark] focus-visible:underline"
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

// ---------------------------------------------------------------------------------------------
// The ranked list
// ---------------------------------------------------------------------------------------------

function PlayBar({ plays, max, accent }: { plays: number; max: number; accent: string }) {
  const pct = max > 0 ? Math.max(plays > 0 ? 3 : 0, Math.round((plays / max) * 100)) : 0;
  return (
    <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 70%, black), ${accent})` }}
      />
    </div>
  );
}

/** Rows keep their plays rank under any sort, so a name or recency sort still shows who is on
 * top. The first three are tinted gold, silver and bronze, like the fan's rims. The bar is
 * scaled to the most-played row in view. */
export function RankedList({ rows, label }: { rows: Row[]; label: string }) {
  const max = Math.max(0, ...rows.map((r) => r.plays));
  return (
    <ol aria-label={label} className="mt-3">
      {rows.map((r) => (
        <li
          key={r.id}
          className="-mx-3 grid grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_7rem_10rem] items-center gap-x-4 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-white/[0.06] lg:grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_11rem_7rem_13rem]"
        >
          <span
            className="st-rank w-7 text-center text-sm font-semibold tabular-nums text-text-hint"
            data-medal={medalFor(r.rank)}
          >
            {r.rank}
          </span>
          <Thumb row={r} size={44} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{r.title}</p>
            <p className="truncate text-sm text-text-muted">{r.subtitle}</p>
          </div>
          <span className="hidden truncate text-sm text-text-muted lg:block">{r.detail}</span>
          <span className="text-sm text-text-hint">{ago(r.lastMins)}</span>
          <div className="flex items-center gap-3">
            <PlayBar plays={r.plays} max={max} accent={r.accent} />
            <span className="w-12 shrink-0 text-right text-[15px] font-semibold tabular-nums" title={playsLabel(r.plays)}>
              {fmt(r.plays)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// Page furniture
// ---------------------------------------------------------------------------------------------

/** Dev-only strip: what this is. */
export function DevStrip() {
  return (
    <div className="mx-auto max-w-[1180px] px-10 pt-4 text-xs text-text-muted">
      <p>Stats page prototype for #145. Sample data, dev only.</p>
    </div>
  );
}

/** The quiet line on the page, and the dev note on what the real data can and cannot do. */
export function FooterNotes() {
  return (
    <footer className="mx-auto mt-16 max-w-[1180px] px-10">
      <p className="text-sm text-text-hint">Plays are counted across all your devices.</p>
      <section
        aria-label="Data needed, dev note"
        className="mt-8 max-w-[860px] rounded-2xl border border-dashed border-white/15 p-5 text-[13px] leading-relaxed text-text-muted"
      >
        <h2 className="text-sm font-semibold text-text-soft">Data needed (dev note, not part of the design)</h2>
        <p className="mt-2">
          Stored today: only absolute running totals. <code>plays.json</code> on the Mac holds{" "}
          <code>{"{ releaseId, count, pushed }"}</code> per track id, and the sync service holds one count per
          device and track, merged with <code>max(stored, sent)</code>. Neither has a timestamp or a history
          (the service keeps <code>updated_at</code>, but it is the last push time and the plays endpoint does
          not return it).
        </p>
        <p className="mt-2">
          So from real data we can build all-time plays per track (one total across devices), per album (the
          sum of its tracks) and per artist (the sum of their releases). We cannot build today, this week, this
          month, this year, any step back or recently played: those figures here are sample numbers, summed
          from an invented day-by-day history.
        </p>
        <p className="mt-2">
          To get them: a count per device, per track, per day (absolute for the day, merged with max like
          today&apos;s totals), kept by the tracker in <code>plays.json</code> and stored and returned by the
          service, plus a last-played time per track. Plays from before that change can only count toward all
          time. The service also reads one release at a time, so a library-wide page needs a call that returns
          every track.
        </p>
      </section>
    </footer>
  );
}
