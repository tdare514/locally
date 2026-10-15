"use client";

import { useContext, useMemo, type ReactNode } from "react";
import RecordSleeve from "../../RecordSleeve";
import {
  ArtistDisc,
  Cover,
  CoversContext,
  Medal,
  RankedList,
  Segmented,
  SelectMenu,
  Sleeve,
  vars,
} from "./parts";
import {
  B_PERIODS,
  RELATIVE_LABEL,
  SORTS,
  TABS,
  TAB_COUNTS,
  ago,
  comparison,
  digestFor,
  fmt,
  playsLabel,
  rankedRows,
  sortRows,
  type Digest,
  type PeriodKey,
  type Row,
  type SortKey,
  type Tab,
} from "./sample-data";

/**
 * Direction A, "Digest first" (#145): sorted and calm. The week arrives as a sentence, then one
 * hero card for the #1 track on a record sleeve, three small tiles, a smaller month row in the
 * same language, and only then the ranked list with its Tracks / Albums / Artists control.
 */

interface Props {
  tab: Tab;
  setTab: (tab: Tab) => void;
  sort: SortKey;
  setSort: (sort: SortKey) => void;
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
}

const LIST_PERIODS = B_PERIODS.map((key) => ({ value: key, label: RELATIVE_LABEL[key] ?? key }));

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

/** The #1 track, as a small cover chip set into the sentence. */
function InlineCover({ row }: { row: Row }) {
  return (
    <span className="mx-[0.14em] inline-block size-[1.02em] translate-y-[0.14em] overflow-hidden rounded-[0.16em] shadow-[0_6px_14px_-6px_rgb(0_0_0/0.7)]">
      <Cover coverId={row.coverId} className="size-full" />
    </span>
  );
}

function Hero({ week }: { week: Digest }) {
  const covers = useContext(CoversContext);
  const top = week.tracks[0];
  return (
    <section
      aria-label="Your number one track this week"
      className="st-a-rise glass-fake relative isolate flex items-center gap-10 rounded-[28px] px-9 py-8"
      style={vars({ "--st-i": 1 })}
    >
      <div className="st-lift shrink-0" style={vars({ "--st-accent": top.accent })}>
        <RecordSleeve labelUrl={covers[top.coverId] ?? null} spin={0}>
          <div className="relative">
            <div className="record-sleeve relative size-[248px] overflow-hidden rounded-[4px] bg-card">
              <Cover coverId={top.coverId} className="size-full" />
            </div>
            <Medal rank={1} size={64} className="absolute -left-4 -top-4" />
          </div>
        </RecordSleeve>
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-text-muted">Your #1 this week</p>
        <h2 className="mt-2 text-[40px] font-extrabold leading-[1.04] tracking-[-0.03em]">{top.title}</h2>
        <p className="mt-2 text-lg text-text-soft">{top.subtitle}</p>
        <p className="text-[15px] text-text-muted">on {top.detail}</p>
        <p className="mt-6 text-[28px] font-bold leading-none tracking-[-0.02em]">{playsLabel(top.plays)}</p>
        <p className="mt-2 text-[15px] text-text-muted">
          {fmt(top.allTime)} in all, last played {ago(top.lastMins).toLowerCase()}
        </p>
      </div>
    </section>
  );
}

function Tile({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className="st-a-rise glass-fake relative isolate flex flex-1 flex-col justify-center rounded-3xl px-5 py-4"
      style={vars({ "--st-i": index })}
    >
      {children}
    </div>
  );
}

function WeekTiles({ week }: { week: Digest }) {
  const album = week.albums[0];
  const artist = week.artists[0];
  const prev = week.prevTotal ?? 0;
  const widest = Math.max(week.total, prev, 1);
  return (
    <div className="flex flex-col gap-4">
      <Tile index={2}>
        <div className="flex items-center gap-4">
          <Sleeve coverId={album.coverId} size={64} peek={0.22} accent={album.accent} className="shrink-0" />
          <div className="min-w-0 pl-3">
            <p className="text-[13px] text-text-muted">Most-played album</p>
            <p className="truncate text-[17px] font-semibold">{album.title}</p>
            <p className="text-[13px] text-text-muted">
              {playsLabel(album.plays)} from {album.detail}
            </p>
          </div>
        </div>
      </Tile>
      <Tile index={3}>
        <div className="flex items-center gap-4">
          <ArtistDisc coverId={artist.coverId} size={64} accent={artist.accent} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] text-text-muted">Artist you played most</p>
            <p className="truncate text-[17px] font-semibold">{artist.title}</p>
            <p className="text-[13px] text-text-muted">
              {playsLabel(artist.plays)}, {share(artist.plays, week.total)} of your week
            </p>
          </div>
        </div>
      </Tile>
      <Tile index={4}>
        <p className="text-[13px] text-text-muted">This week against last week</p>
        <p className="mt-0.5 text-[17px] font-semibold">{comparison(week)}</p>
        <div className="mt-3 space-y-2" aria-hidden>
          {[
            { name: "This week", value: week.total, strong: true },
            { name: "Last week", value: prev, strong: false },
          ].map((bar) => (
            <div key={bar.name} className="flex items-center gap-3 text-[13px]">
              <span className="w-[4.5rem] text-text-muted">{bar.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${bar.strong ? "bg-white" : "bg-white/40"}`}
                  style={{ width: `${(bar.value / widest) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-semibold tabular-nums">{bar.value}</span>
            </div>
          ))}
        </div>
      </Tile>
    </div>
  );
}

function MonthItem({ row, label, medal }: { row: Row; label: string; medal?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative shrink-0">
        {row.round ? (
          <ArtistDisc coverId={row.coverId} size={48} accent={row.accent} />
        ) : (
          <Sleeve coverId={row.coverId} size={48} peek={0.18} accent={row.accent} />
        )}
        {medal && <Medal rank={1} size={22} ribbon={false} className="absolute -left-2 -top-2" />}
      </div>
      <div className="min-w-0 pl-2">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="truncate text-[15px] font-semibold">{row.title}</p>
        <p className="text-[13px] text-text-muted">{playsLabel(row.plays)}</p>
      </div>
    </div>
  );
}

function MonthRow({ month }: { month: Digest }) {
  return (
    <section
      aria-label="This month"
      className="st-a-rise glass-fake relative isolate mt-5 flex items-center gap-8 rounded-3xl px-7 py-5"
      style={vars({ "--st-i": 5 })}
    >
      <div className="w-[250px] shrink-0">
        <h2 className="text-lg font-bold">This month</h2>
        <p className="mt-1 text-sm text-text-muted">
          {fmt(month.total)} plays in October, {comparison(month)}.
        </p>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-6">
        <MonthItem row={month.tracks[0]} label="Top track" medal />
        <MonthItem row={month.albums[0]} label="Top album" />
        <MonthItem row={month.artists[0]} label="Top artist" />
      </div>
    </section>
  );
}

export default function DirectionA({ tab, setTab, sort, setSort, period, setPeriod }: Props) {
  const week = useMemo(() => digestFor("this-week"), []);
  const month = useMemo(() => digestFor("october"), []);
  const rows = useMemo(() => sortRows(rankedRows(tab, period), sort), [tab, period, sort]);
  const top = week.tracks[0];
  const noun = TABS.find((t) => t.value === tab)?.label.toLowerCase() ?? "tracks";

  return (
    <main className="mx-auto max-w-[1180px] px-10 pt-8">
      <header className="st-a-rise" style={vars({ "--st-i": 0 })}>
        <h1 className="text-[22px] font-bold tracking-tight">Streams</h1>
        <p className="mt-5 max-w-[940px] text-[40px] font-semibold leading-[1.12] tracking-[-0.025em]">
          You played your tracks {fmt(week.total)} times this week, mostly{" "}
          <span className="whitespace-nowrap">
            <InlineCover row={top} />
            {top.title}.
          </span>
        </p>
      </header>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_350px] items-stretch gap-5">
        <Hero week={week} />
        <WeekTiles week={week} />
      </div>

      <MonthRow month={month} />

      <section aria-label="All plays" className="mt-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Group by"
            value={tab}
            onChange={setTab}
            options={TABS.map((t) => ({ ...t, count: TAB_COUNTS[t.value] }))}
          />
          <div className="flex items-center gap-2">
            <SelectMenu label="Plays from" value={period} onChange={setPeriod} options={LIST_PERIODS} />
            <SelectMenu label="Sort by" value={sort} onChange={setSort} options={SORTS} />
          </div>
        </div>
        <RankedList rows={rows} label={`Your ${noun}, ${sort === "plays" ? "most played first" : sort === "name" ? "by name" : "most recent first"}`} />
      </section>
    </main>
  );
}
