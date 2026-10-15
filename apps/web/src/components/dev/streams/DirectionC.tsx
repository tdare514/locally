"use client";

import { useMemo, useRef } from "react";
import { ChevronRightIcon } from "../../Icons";
import { ArtistDisc, RankedList, Segmented, SelectMenu, Sleeve, vars } from "./parts";
import {
  PERIODS,
  SORTS,
  TABS,
  TAB_COUNTS,
  digestFor,
  headline,
  playsLabel,
  rankedRows,
  sortRows,
  type PeriodKey,
  type Row,
  type SortKey,
  type Tab,
} from "./sample-data";

/**
 * Direction C, "Replay shelf" (#145): bold and editorial. A quiet period scroller, one playful
 * sentence, then a shelf of big ranked sleeves with an outlined numeral across each cover
 * (gold, silver and bronze strokes for the first three), and the denser sortable list under it.
 */

interface Props {
  tab: Tab;
  setTab: (tab: Tab) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
}

/** Weeks, months and all time, with a hairline between the groups. */
const CHIP_GROUPS: PeriodKey[][] = [
  ["this-week", "last-week"],
  ["october", "september", "august", "july"],
  ["all-time"],
];

const CARD = 264;
const PEEK = 0.2;
const SHELF_LIMIT = 12;
/** Lines the first card up with the page column; the scroll padding keeps snapping from undoing it. */
const SHELF_INSET = "max(2.5rem, calc((100vw - 1180px) / 2 + 2.5rem))";

function ShelfCard({ row, index }: { row: Row; index: number }) {
  const rank = row.rank ?? 0;
  const numeral = (
    <span
      aria-hidden
      className="st-c-numeral"
      data-rank={rank}
      data-wide={rank >= 10}
    >
      {rank}
    </span>
  );
  return (
    <li
      className="st-c-rise shrink-0"
      style={vars({ "--st-i": Math.min(index, 5), width: CARD })}
      aria-label={`Number ${rank}, ${row.title}, ${playsLabel(row.plays)}`}
    >
      {row.round ? (
        <ArtistDisc coverId={row.coverId} size={CARD} accent={row.accent}>
          {numeral}
        </ArtistDisc>
      ) : (
        <Sleeve coverId={row.coverId} size={CARD} peek={PEEK} accent={row.accent}>
          {numeral}
        </Sleeve>
      )}
      <div className="mt-12">
        <p className="line-clamp-2 text-xl font-bold leading-tight tracking-[-0.015em]">{row.title}</p>
        <p className="mt-1 truncate text-[15px] text-text-muted">{row.subtitle}</p>
        <p className="mt-2 text-[15px] font-semibold">{playsLabel(row.plays)}</p>
      </div>
    </li>
  );
}

export default function DirectionC({ tab, setTab, sort, setSort, period, setPeriod }: Props) {
  const digest = useMemo(() => digestFor(period), [period]);
  const ranked = useMemo(() => rankedRows(tab, period), [tab, period]);
  const shelf = ranked.filter((r) => r.plays > 0).slice(0, SHELF_LIMIT);
  const list = useMemo(() => sortRows(ranked, sort), [ranked, sort]);
  const shelfRef = useRef<HTMLOListElement>(null);
  const noun = TABS.find((t) => t.value === tab)?.label.toLowerCase() ?? "tracks";

  function scrollShelf(direction: 1 | -1) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    shelfRef.current?.scrollBy({
      left: direction * (CARD + 76) * 3,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  return (
    <main className="pt-8">
      <div className="mx-auto max-w-[1180px] px-10">
        <h1 className="text-[22px] font-bold tracking-tight">Streams</h1>

        <div
          role="group"
          aria-label="Period"
          className="mt-5 flex items-center gap-1 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]"
        >
          {CHIP_GROUPS.map((group, g) => (
            <div key={g} className="flex shrink-0 items-center gap-1">
              {g > 0 && <span aria-hidden className="mx-2 h-4 w-px bg-white/15" />}
              {group.map((key) => {
                const on = key === period;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPeriod(key)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      on ? "bg-white/15 text-white" : "text-text-muted hover:text-white"
                    }`}
                  >
                    {PERIODS.find((p) => p.key === key)?.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <h2
          className="st-c-rise mt-8 max-w-[1000px] text-balance text-[52px] font-extrabold leading-[1.02] tracking-[-0.04em]"
          style={vars({ "--st-i": 0 })}
        >
          {headline(digest)}
        </h2>

        <div className="mt-10 flex items-center justify-between gap-3">
          <Segmented
            label="Group by"
            value={tab}
            onChange={setTab}
            options={TABS.map((t) => ({ ...t, count: TAB_COUNTS[t.value] }))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Scroll the shelf back"
              onClick={() => scrollShelf(-1)}
              className="glass-fake relative isolate grid size-9 place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronRightIcon className="h-4 w-4 rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Scroll the shelf forward"
              onClick={() => scrollShelf(1)}
              className="glass-fake relative isolate grid size-9 place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* The shelf runs the full width of the window; its first card lines up with the column. */}
      <ol
        key={`${tab}-${period}`}
        ref={shelfRef}
        aria-label={`Your top ${noun}, ${digest.period === "all-time" ? "all time" : PERIODS.find((p) => p.key === period)?.label.toLowerCase()}`}
        className="st-c-shelf flex items-start gap-[76px] overflow-x-auto pb-6 pt-8"
        style={{ paddingInline: SHELF_INSET, scrollPaddingInline: SHELF_INSET }}
      >
        {shelf.map((row, i) => (
          <ShelfCard key={row.id} row={row} index={i} />
        ))}
      </ol>

      <section aria-label="All plays" className="mx-auto mt-6 max-w-[1180px] px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">
            All {TAB_COUNTS[tab]} {noun}
          </h2>
          <SelectMenu label="Sort by" value={sort} onChange={setSort} options={SORTS} />
        </div>
        <RankedList
          dense
          rows={list}
          label={`Your ${noun}, ${sort === "plays" ? "most played first" : sort === "name" ? "by name" : "most recent first"}`}
        />
      </section>
    </main>
  );
}
