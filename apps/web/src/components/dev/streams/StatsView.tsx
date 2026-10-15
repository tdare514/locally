"use client";

import { useMemo } from "react";
import StatFan from "./StatFan";
import { Cover, GlassToggle, PeriodStepper, RankedList, SelectMenu, Toggle, vars } from "./parts";
import {
  PERIOD_KINDS,
  SORTS,
  TABS,
  digestSentence,
  fmt,
  playsLabel,
  rankedRows,
  sortRows,
  type Period,
  type Row,
  type SortKey,
  type Tab,
  type View,
} from "./sample-data";

/**
 * The #145 Stats page body. Top to bottom: the heading with the time frame, a one-line digest, the
 * Tracks / Albums / Artists switch, the five-sleeve fan of the top five (the sidebar's shelf at
 * page size), then everyone ranked, as a list or as the sorted sea (covers sized by plays, in rank
 * order). The switch and the time frame drive the fan and everything below it.
 */

interface Props {
  tab: Tab;
  setTab: (tab: Tab) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  period: Period;
  setPeriod: (period: Period) => void;
  view: View;
  setView: (view: View) => void;
}

const VIEWS: { value: View; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

/** How the sea steps down: columns per row and what each cover shows. */
const TIERS = [
  { cols: 6, grid: "grid-cols-6 gap-x-5 gap-y-6", caption: "full" },
  { cols: 8, grid: "grid-cols-8 gap-x-4 gap-y-5", caption: "name" },
  { cols: 10, grid: "grid-cols-10 gap-x-3 gap-y-4", caption: "none" },
] as const;

function SeaItem({ row, tier }: { row: Row; tier: 0 | 1 | 2 }) {
  const round = row.round;
  return (
    <li className="min-w-0" title={`${row.title}, ${playsLabel(row.plays)}`}>
      <div className="st-lift relative" style={vars({ "--st-accent": row.accent })}>
        <div
          className={`relative aspect-square w-full overflow-hidden bg-card ${
            round ? "st-disc" : "record-sleeve rounded-[4px]"
          }`}
        >
          <Cover coverId={row.coverId} className="size-full" />
        </div>
        <span
          className={`absolute rounded-full bg-black/55 px-1.5 text-[11px] font-semibold leading-5 tabular-nums ${
            round ? "left-[9%] top-[9%]" : "left-1.5 top-1.5"
          }`}
        >
          {row.rank}
        </span>
        <span
          className={`absolute rounded-full bg-black/60 px-2 text-[11px] font-semibold leading-5 tabular-nums ${
            round ? "bottom-[9%] right-[9%]" : "bottom-1.5 right-1.5"
          }`}
        >
          {tier === 2 ? fmt(row.plays) : playsLabel(row.plays)}
        </span>
      </div>
      {tier === 2 ? (
        <span className="sr-only">{row.title}</span>
      ) : (
        <div className="mt-2">
          <p className="truncate text-sm font-semibold">{row.title}</p>
          {tier === 0 && <p className="truncate text-[13px] text-text-muted">{row.subtitle}</p>}
        </div>
      )}
    </li>
  );
}

function Sea({ rows, label }: { rows: Row[]; label: string }) {
  const first = rows.slice(0, TIERS[0].cols);
  const second = rows.slice(TIERS[0].cols, TIERS[0].cols + TIERS[1].cols);
  const third = rows.slice(TIERS[0].cols + TIERS[1].cols);
  const groups = [first, second, third];
  return (
    <section aria-label={label} className="mt-4">
      <p className="text-sm text-text-muted">Ranked by plays, left to right. Bigger covers have more plays.</p>
      <div className="mt-5 space-y-6">
        {groups.map(
          (group, t) =>
            group.length > 0 && (
              <ol key={t} className={`grid ${TIERS[t].grid}`}>
                {group.map((row) => (
                  <SeaItem key={row.id} row={row} tier={t as 0 | 1 | 2} />
                ))}
              </ol>
            ),
        )}
      </div>
    </section>
  );
}

export default function StatsView({ tab, setTab, sort, setSort, period, setPeriod, view, setView }: Props) {
  const digest = useMemo(() => digestSentence(period), [period]);
  const ranked = useMemo(() => rankedRows(tab, period), [tab, period]);
  const played = useMemo(() => ranked.filter((r) => r.plays > 0), [ranked]);
  const listed = useMemo(() => sortRows(played, sort), [played, sort]);
  const quiet = ranked.length - played.length;
  const noun = TABS.find((t) => t.value === tab)?.label.toLowerCase() ?? "tracks";
  const singular = noun.replace(/s$/, "");

  return (
    <main className="mx-auto max-w-[1180px] px-10 pt-8">
      <header className="st-rise flex flex-wrap items-center justify-between gap-x-6 gap-y-3" style={vars({ "--st-i": 0 })}>
        <h1 className="text-[22px] font-bold tracking-tight">Stats</h1>
        <GlassToggle
          label="Time frame"
          value={period.kind}
          onChange={(kind) => setPeriod({ kind, back: 0 })}
          options={PERIOD_KINDS}
        />
      </header>
      <div
        className="st-rise mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
        style={vars({ "--st-i": 1 })}
      >
        <p className="max-w-[760px] text-balance text-[22px] font-medium leading-snug text-text-soft">{digest}</p>
        <PeriodStepper period={period} onChange={setPeriod} />
      </div>

      <div className="st-rise mt-8" style={vars({ "--st-i": 2 })}>
        <Toggle label="Show top" value={tab} onChange={setTab} options={TABS} className="-ml-[0.9rem]" />
      </div>

      {played.length === 0 ? (
        <p className="mt-16 text-text-muted">No plays in this time frame.</p>
      ) : (
        <>
          {/* Keyed so each tab or period change fans the sleeves out once, in answer to the click. */}
          <div key={`fan-${tab}-${period.kind}-${period.back}`} className="mt-6">
            <StatFan rows={played.slice(0, 5)} label={`Your top ${Math.min(5, played.length)} ${noun}, most played first`} />
          </div>

          <section aria-label={`All your ${noun}`} className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Your {noun}</h2>
              <div className="flex items-center gap-4">
                {view === "list" && <SelectMenu label="Sort by" value={sort} onChange={setSort} options={SORTS} />}
                <Toggle label="Layout" value={view} onChange={setView} options={VIEWS} className="-mr-[0.9rem]" />
              </div>
            </div>
            <div key={`${view}-${tab}-${period.kind}-${period.back}`} className="st-rise" style={vars({ "--st-i": 0 })}>
              {view === "list" ? (
                <RankedList
                  rows={listed}
                  label={`Your ${noun}, ${sort === "plays" ? "most played first" : sort === "name" ? "by name" : "most recent first"}`}
                />
              ) : (
                <Sea rows={played} label={`Your ${noun}, in rank order`} />
              )}
              {quiet > 0 && (
                <p className="mt-6 text-sm text-text-muted">
                  {quiet} {quiet === 1 ? singular : noun} had no plays in this time frame.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
