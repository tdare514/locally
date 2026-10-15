"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronRightIcon } from "../../Icons";
import {
  VARIANTS,
  ago,
  fmt,
  playsLabel,
  type Row,
  type Tab,
  type Variant,
} from "./sample-data";

/** Pieces shared by the three directions of the #145 Streams page prototype. */

/** Cover id -> data URI. The server page builds it from the demo library's drawn SVGs. */
export const CoversContext = createContext<Record<string, string>>({});

/** Sets custom properties (`--st-i`, `--st-accent`) from React. */
export function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

// ---------------------------------------------------------------------------------------------
// Covers: sleeve, disc, fluid cover
// ---------------------------------------------------------------------------------------------

export function Cover({ coverId, className = "" }: { coverId: string; className?: string }) {
  const src = useContext(CoversContext)[coverId];
  if (!src) return <div className={`bg-elevated ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an inline data-URI SVG, nothing to optimise
    <img src={src} alt="" draggable={false} className={`object-cover ${className}`} />
  );
}

/** A record sleeve of `size` px with the disc peeking out of its right edge (the release page's
 * look, #112, at any size). The layout box is the sleeve alone, so the disc overhangs into the
 * gap; `children` sit on top and are positioned against the sleeve's corner. */
export function Sleeve({
  coverId,
  size,
  peek = 0.2,
  accent,
  className = "",
  children,
}: {
  coverId: string;
  size: number;
  /** How far the disc shows, as a fraction of the sleeve. 0 hides it. */
  peek?: number;
  accent: string;
  className?: string;
  children?: ReactNode;
}) {
  const src = useContext(CoversContext)[coverId];
  const peekPx = Math.round(size * peek);
  const disc = Math.round(size * 0.92);
  return (
    <div
      className={`record st-lift relative w-fit ${className}`}
      style={vars({ "--st-accent": accent, marginRight: -peekPx, paddingRight: peekPx })}
    >
      {peek > 0 && (
        <div aria-hidden className="record-disc" style={{ width: disc, height: disc }}>
          <div className="record-face">
            <div
              className="record-label"
              style={src ? { backgroundImage: `url("${src}")` } : undefined}
            />
          </div>
          <div className="record-sheen" />
        </div>
      )}
      <div className="relative">
        <div
          className="record-sleeve relative overflow-hidden rounded-[4px] bg-card"
          style={{ width: size, height: size }}
        >
          <Cover coverId={coverId} className="size-full" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** An artist: the cover of their most-played release cut to a record, with a spindle hole. */
export function ArtistDisc({
  coverId,
  size,
  accent,
  className = "",
  children,
}: {
  coverId: string;
  size: number;
  accent: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`st-lift relative w-fit ${className}`} style={vars({ "--st-accent": accent })}>
      <div className="st-disc overflow-hidden" style={{ width: size, height: size }}>
        <Cover coverId={coverId} className="size-full" />
      </div>
      {children}
    </div>
  );
}

/** A small square (or round) cover for list rows and tiles. */
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
// Medals
// ---------------------------------------------------------------------------------------------

/** True once the element has been at least mostly on screen; never goes back. The medal's one
 * shine plays off this, so a medal far down the page shines when you reach it, not on load. */
function useSeenOnce<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

const MEDAL_NAMES = ["Gold", "Silver", "Bronze"];

export function medalRank(rank: number | null): 1 | 2 | 3 | null {
  return rank === 1 || rank === 2 || rank === 3 ? rank : null;
}

/** #1 gold, #2 silver, #3 bronze: a metal coin, on ribbon tails when it is big enough. */
export function Medal({
  rank,
  size = 40,
  ribbon = true,
  className = "",
}: {
  rank: 1 | 2 | 3;
  size?: number;
  ribbon?: boolean;
  className?: string;
}) {
  const [ref, seen] = useSeenOnce<HTMLSpanElement>();
  // `className` positions the wrapper; `.st-medal` is unlayered CSS and would beat a utility like
  // `absolute` if it were set on the same element.
  return (
    <span className={`inline-block ${className}`}>
      <span
        ref={ref}
        role="img"
        aria-label={`${MEDAL_NAMES[rank - 1]} medal, number ${rank}`}
        data-rank={rank}
        data-ribbon={ribbon}
        data-seen={seen}
        className="st-medal"
        style={vars({ "--m": `${size}px` })}
      >
        {ribbon && <span className="st-medal-ribbon" />}
        <span aria-hidden className="st-medal-coin">
          {rank}
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

/** A pill group: faked glass track, the chosen option a solid white pill. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`glass-fake relative isolate inline-flex rounded-full p-1 ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-[background-color,color,transform] duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              on ? "bg-white text-black" : "text-text-soft hover:text-white"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`ml-1.5 font-medium ${on ? "text-black/55" : "text-text-hint"}`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
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
// The ranked list (A, and C's denser version)
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

function RankCell({ rank }: { rank: number | null }) {
  const medal = medalRank(rank);
  if (medal) return <Medal rank={medal} size={28} ribbon={false} />;
  return (
    <span className="w-7 text-center text-sm font-medium tabular-nums text-text-hint">
      {rank ?? "-"}
    </span>
  );
}

/** Rows keep their plays rank (and medals) under any sort, so a name or recency sort still
 * shows who is on top. The bar is scaled to the most-played row in view. */
export function RankedList({
  rows,
  dense = false,
  label,
}: {
  rows: Row[];
  dense?: boolean;
  label: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.plays));
  const grid = dense
    ? "grid-cols-[1.75rem_2rem_minmax(0,1fr)_6.5rem_9rem] lg:grid-cols-[1.75rem_2rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem_10rem]"
    : "grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_7rem_10rem] lg:grid-cols-[1.75rem_2.75rem_minmax(0,1fr)_11rem_7rem_13rem]";
  return (
    <ol aria-label={label} className="mt-3">
      {rows.map((r) => (
        <li
          key={r.id}
          className={`-mx-3 grid items-center gap-x-4 rounded-xl px-3 transition-colors duration-150 hover:bg-white/[0.06] ${grid} ${
            dense ? "py-1.5" : "py-2.5"
          }`}
        >
          <RankCell rank={r.rank} />
          <Thumb row={r} size={dense ? 32 : 44} />
          {dense ? (
            <>
              <span className="truncate text-sm font-semibold">{r.title}</span>
              <span className="hidden truncate text-sm text-text-muted lg:block">{r.subtitle}</span>
              <span className="hidden truncate text-sm text-text-muted lg:block">{r.detail}</span>
            </>
          ) : (
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{r.title}</p>
              <p className="truncate text-sm text-text-muted">{r.subtitle}</p>
            </div>
          )}
          {!dense && <span className="hidden truncate text-sm text-text-muted lg:block">{r.detail}</span>}
          <span className="text-sm text-text-hint">{ago(r.lastMins)}</span>
          <div className="flex items-center gap-3">
            <PlayBar plays={r.plays} max={max} accent={r.accent} />
            <span
              className={`w-12 shrink-0 text-right text-[15px] font-semibold tabular-nums ${
                r.plays === 0 ? "text-text-dim" : ""
              }`}
              title={playsLabel(r.plays)}
            >
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

/** Dev-only strip: what this is, and the switch between the three directions. */
export function DevStrip({ variant, tab }: { variant: Variant; tab: Tab }) {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-10 pt-4 text-xs text-text-muted">
      <p>Streams page prototype for #145. Sample data, dev only.</p>
      <nav aria-label="Direction" className="flex gap-1.5">
        {VARIANTS.map((v) => (
          <Link
            key={v.value}
            href={`/dev/streams?v=${v.value}&tab=${tab}`}
            aria-current={v.value === variant ? "page" : undefined}
            className={`rounded-full px-3 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              v.value === variant ? "bg-white text-black" : "bg-white/10 text-text-soft hover:bg-white/15"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The quiet line on every direction, and the dev note on what the real data can and cannot do. */
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
          sum of its tracks) and per artist (the sum of their releases). We cannot build this week, this month,
          last week or recently played: those figures here are sample numbers.
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
