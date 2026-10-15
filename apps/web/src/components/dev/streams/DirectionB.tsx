"use client";

import { useMemo } from "react";
import {
  ArtistDisc,
  Cover,
  Medal,
  Segmented,
  Sleeve,
  vars,
} from "./parts";
import {
  B_PERIODS,
  RELATIVE_LABEL,
  TABS,
  TAB_COUNTS,
  compactSentence,
  digestFor,
  fmt,
  playsLabel,
  rankedRows,
  type PeriodKey,
  type Row,
  type Tab,
} from "./sample-data";

/**
 * Direction B, "Podium and sorted sea" (#145): the owner's sea of tracks, made orderly. Gold
 * stands raised in the middle with silver and bronze beside it; everyone else follows in rank
 * order, left to right and row by row, with the cover size stepping down as the plays do.
 */

interface Props {
  tab: Tab;
  setTab: (tab: Tab) => void;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
}

const PERIOD_OPTIONS = B_PERIODS.map((key) => ({ value: key, label: RELATIVE_LABEL[key] ?? key }));

/** Podium places in rank order, which is the reading order; `order` seats silver on the left and
 * bronze on the right. */
const PLACES = [
  { rank: 1, size: 232, step: 116, numeral: 76, medal: 60, rise: 2, order: 2 },
  { rank: 2, size: 188, step: 84, numeral: 58, medal: 48, rise: 1, order: 1 },
  { rank: 3, size: 168, step: 62, numeral: 46, medal: 44, rise: 0, order: 3 },
] as const;

/** How the rest of the sea steps down: columns per row and what each cover shows. */
const TIERS = [
  { cols: 6, grid: "grid-cols-6 gap-x-5 gap-y-6", caption: "full" },
  { cols: 8, grid: "grid-cols-8 gap-x-4 gap-y-5", caption: "name" },
  { cols: 10, grid: "grid-cols-10 gap-x-3 gap-y-4", caption: "none" },
] as const;

function PodiumPlace({ row, place }: { row: Row; place: (typeof PLACES)[number] }) {
  const medal = <Medal rank={place.rank} size={place.medal} className="absolute -left-3 -top-3 z-10" />;
  return (
    <li className="flex flex-col items-center" style={{ width: place.size + 76, order: place.order }}>
      <div
        className="st-b-rise flex flex-col items-center"
        style={vars({ "--st-i": place.rise })}
      >
        {row.round ? (
          <ArtistDisc coverId={row.coverId} size={place.size} accent={row.accent}>
            {medal}
          </ArtistDisc>
        ) : (
          <Sleeve coverId={row.coverId} size={place.size} peek={0.15} accent={row.accent}>
            {medal}
          </Sleeve>
        )}
        <div className="mt-4 text-center" style={{ width: place.size + 40 }}>
          <p className={`text-balance font-bold leading-tight tracking-[-0.01em] text-white ${place.rank === 1 ? "text-xl" : "text-base"}`}>
            {row.title}
          </p>
          <p className="mt-0.5 truncate text-sm text-text-muted">{row.subtitle}</p>
          <p className="mt-1 text-[15px] font-semibold">{playsLabel(row.plays)}</p>
        </div>
      </div>
      <div className="st-b-step mt-5 w-full" data-rank={place.rank} style={{ height: place.step }}>
        <span aria-hidden className="st-b-step-rank" style={{ fontSize: place.numeral }}>
          {place.rank}
        </span>
      </div>
    </li>
  );
}

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

function Sea({ rows, quiet, noun }: { rows: Row[]; quiet: number; noun: string }) {
  const first = rows.slice(0, TIERS[0].cols);
  const second = rows.slice(TIERS[0].cols, TIERS[0].cols + TIERS[1].cols);
  const third = rows.slice(TIERS[0].cols + TIERS[1].cols);
  const groups = [first, second, third];
  return (
    <section aria-label={`The rest of your ${noun}, in rank order`} className="mt-14">
      <p className="text-sm text-text-muted">
        Ranked from {rows[0]?.rank ?? 4}, left to right. Bigger covers have more plays.
        {quiet > 0 && ` ${quiet} ${quiet === 1 ? noun.replace(/s$/, "") : noun} had no plays.`}
      </p>
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

export default function DirectionB({ tab, setTab, period, setPeriod }: Props) {
  const digest = useMemo(() => digestFor(period), [period]);
  const ranked = useMemo(() => rankedRows(tab, period), [tab, period]);
  const played = ranked.filter((r) => r.plays > 0);
  const podium = played.slice(0, 3);
  const sea = played.slice(3);
  const noun = TABS.find((t) => t.value === tab)?.label.toLowerCase() ?? "tracks";

  return (
    <main className="mx-auto max-w-[1180px] px-10 pt-8">
      <header className="st-b-rise flex flex-wrap items-center justify-between gap-4" style={vars({ "--st-i": 0 })}>
        <h1 className="text-[22px] font-bold tracking-tight">Streams</h1>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
      </header>
      <p
        className="st-b-rise mt-6 max-w-[760px] text-balance text-[22px] font-medium leading-snug text-text-soft"
        style={vars({ "--st-i": 1 })}
      >
        {compactSentence(digest)}
      </p>

      <div className="mt-8">
        <Segmented
          label="Group by"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ ...t, count: TAB_COUNTS[t.value] }))}
        />
      </div>

      {/* Keyed so each tab or period change plays the rise once, in answer to the click. */}
      <div key={`${tab}-${period}`}>
        <ol aria-label={`Your top three ${noun}`} className="mt-10 flex items-end justify-center">
          {PLACES.map((place) => {
            const row = podium[place.rank - 1];
            return row ? <PodiumPlace key={place.rank} row={row} place={place} /> : null;
          })}
        </ol>
        <Sea rows={sea} quiet={ranked.length - played.length} noun={noun} />
      </div>
    </main>
  );
}
