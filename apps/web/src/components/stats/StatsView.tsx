"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Release } from "../../shared/types";
import { getSettings } from "../../lib/api-client";
import { IS_DEMO } from "../../lib/demo";
import { FAN_MAX } from "../../lib/fan-layout";
import { canStepBack, selectionRange, type PageKind, type PeriodSelection } from "../../lib/play-periods";
import { STAT_KINDS, type StatItem, type StatKind } from "../../lib/play-stats";
import {
  PAGE_PERIODS,
  countingLine,
  digestSentence,
  emptyPeriodLine,
  periodDetail,
  periodLabel,
} from "../../lib/stats-copy";
import { SORTS, sortItems, type SortKey } from "../../lib/stats-layout";
import { useArtworkPalette } from "../../lib/use-artwork-palette";
import AmbientBackdrop from "../AmbientBackdrop";
import { statCoverUrl } from "../sidebar/StatCover";
import { usePlayStats } from "../sidebar/use-stats";
import { GlassToggle, PeriodStepper, SelectMenu, Toggle } from "./controls";
import SleeveFan from "./SleeveFan";
import { StatsList, StatsSea } from "./StatsRows";

/**
 * The Stats page (#145). Top to bottom: the heading with the period, a one-line digest and the
 * stepper, what is counted, the Tracks / Albums / Artists switch, the five-sleeve fan of the top
 * five (the sidebar's shelf at page size), then everyone ranked from #1, as a list or as the sorted
 * sea (covers sized by plays, in rank order). The switch and the period drive the fan and
 * everything below it. The wash is the cover of whatever is #1 in the current view.
 */

export type StatsLayout = "list" | "grid";

/** What the page remembers while it is not on screen (AppShell holds it). */
export interface StatsPrefs {
  tab: StatKind;
  period: PeriodSelection;
  layout: StatsLayout;
  sort: SortKey;
}

export const DEFAULT_STATS_PREFS: StatsPrefs = {
  tab: "tracks",
  period: { kind: "week", back: 0 },
  layout: "list",
  sort: "plays",
};

const LAYOUTS: { value: StatsLayout; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

const STEP_NOUN: Record<PageKind, string> = { today: "day", week: "week", month: "month", year: "year", all: "" };

export default function StatsView({
  releases,
  loadingLibrary,
  prefs,
  onPrefsChange,
  onOpenRelease,
  onOpenArtist,
  onOpenSettings,
}: {
  releases: Release[];
  loadingLibrary: boolean;
  prefs: StatsPrefs;
  onPrefsChange: (patch: Partial<StatsPrefs>) => void;
  onOpenRelease: (id: string) => void;
  /** Shows the Library filtered to this artist. */
  onOpenArtist: (name: string) => void;
  onOpenSettings: () => void;
}) {
  const { tab, period, layout, sort } = prefs;
  const { state, countingSince, today, firstDay } = usePlayStats(period, releases, true, Infinity);
  const counting = usePlayCounting();

  const stats = state.status === "ready" ? state.stats : null;
  const items = useMemo(() => (stats ? stats[tab] : []), [stats, tab]);
  const meta = STAT_KINDS.find((k) => k.key === tab) ?? STAT_KINDS[0];
  const noun = meta.tab.toLowerCase();
  const range = useMemo(() => selectionRange(period, today, firstDay), [period, today, firstDay]);
  const canBack = canStepBack(period, today, firstDay);
  const lead = items[0];
  const palette = useArtworkPalette(lead ? statCoverUrl(lead.cover) : null);
  const listed = useMemo(() => sortItems(items, sort), [items, sort]);

  const open = (item: StatItem) => {
    if (item.releaseId) onOpenRelease(item.releaseId);
    else onOpenArtist(item.title);
  };

  const digest =
    state.status === "ready" && stats
      ? digestSentence(period, stats.total, stats.tracks[0]?.title ?? null)
      : state.status === "quiet"
        ? emptyPeriodLine(period)
        : " ";
  const busy = state.status === "loading" || loadingLibrary;
  const showControls = state.status !== "empty";

  return (
    <div className="st-root mx-auto max-w-[1180px] pb-10" style={palette ? ({ "--btn-tint": palette.primary } as CSSProperties) : undefined}>
      <AmbientBackdrop palette={palette} />
      <div aria-hidden className="st-scrim" />
      <header className="st-rise flex flex-wrap items-center justify-between gap-x-6 gap-y-3" style={{ "--st-i": 0 } as CSSProperties}>
        <h1 className="text-[22px] font-bold tracking-tight">Stats</h1>
        {showControls && (
          <GlassToggle
            label="Time frame"
            value={period.kind}
            onChange={(kind) => onPrefsChange({ period: { kind, back: 0 } })}
            options={PAGE_PERIODS}
          />
        )}
      </header>

      {showControls && (
        <div
          className="st-rise mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
          style={{ "--st-i": 1 } as CSSProperties}
        >
          <p aria-live="polite" className="max-w-[760px] text-balance text-lg font-medium leading-snug text-text-soft md:text-[22px]">
            {digest}
          </p>
          <PeriodStepper
            noun={STEP_NOUN[period.kind]}
            title={periodLabel(period)}
            detail={periodDetail(period, range, today)}
            stepped={period.back > 0}
            canBack={canBack}
            canForward={period.back > 0}
            onBack={() => onPrefsChange({ period: { ...period, back: period.back + 1 } })}
            onForward={() => onPrefsChange({ period: { ...period, back: Math.max(0, period.back - 1) } })}
          />
        </div>
      )}

      <Coverage
        status={state.status}
        counting={counting}
        countingSince={countingSince}
        today={today}
        onOpenSettings={onOpenSettings}
      />

      {state.status === "error" && (
        <p className="mt-10 text-text-muted">
          Couldn&apos;t load your plays. It tries again when you come back to this window.
        </p>
      )}

      {showControls && (
        <div className="st-rise mt-8" style={{ "--st-i": 2 } as CSSProperties}>
          <Toggle
            label="Show top"
            value={tab}
            onChange={(next) => onPrefsChange({ tab: next })}
            options={STAT_KINDS.map((k) => ({ value: k.key, label: k.tab }))}
            className="-ml-[0.9rem]"
          />
        </div>
      )}

      {state.status === "loading" || (loadingLibrary && state.status !== "ready") ? (
        <div aria-busy={busy} className="min-h-[24rem]" />
      ) : null}

      {stats && items.length > 0 && (
        <>
          {/* Keyed so each tab or period change fans the sleeves out once, in answer to the click. */}
          <div className="st-fan-stage mt-6" key={`fan-${tab}-${period.kind}-${period.back}`}>
            <SleeveFan
              items={items.slice(0, FAN_MAX)}
              size="page"
              disc={tab === "artists"}
              label={`Your top ${Math.min(FAN_MAX, items.length)} ${noun}, most played first`}
              onOpen={open}
            />
          </div>

          <section aria-label={`All your ${noun}`} className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Your {noun}</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {layout === "list" && (
                  <SelectMenu label="Sort by" value={sort} onChange={(next) => onPrefsChange({ sort: next })} options={SORTS} />
                )}
                <Toggle
                  label="Layout"
                  value={layout}
                  onChange={(next) => onPrefsChange({ layout: next })}
                  options={LAYOUTS}
                  className="sm:-mr-[0.9rem]"
                />
              </div>
            </div>
            <div key={`${layout}-${tab}-${period.kind}-${period.back}`} className="st-rise" style={{ "--st-i": 0 } as CSSProperties}>
              {layout === "list" ? (
                <StatsList
                  items={listed}
                  label={`Your ${noun}, ${sort === "plays" ? "most played first" : sort === "name" ? "by name" : "most recent first"}`}
                  round={tab === "artists"}
                  today={today}
                  onOpen={open}
                />
              ) : (
                <StatsSea items={items} label={`Your ${noun}, in rank order`} round={tab === "artists"} onOpen={open} />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Whether play counting is on, from the Settings: null until it is known (and always in the demo). */
function usePlayCounting(): boolean | null {
  const [counting, setCounting] = useState<boolean | null>(null);
  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    getSettings()
      .then((settings) => {
        if (alive) setCounting(settings.trackPlays);
      })
      .catch(() => {
        // Without the setting the page just does not say whether counting is on.
      });
    return () => {
      alive = false;
    };
  }, []);
  return counting;
}

/** The quiet lines about what is counted: where from and since when, or that counting is off. */
function Coverage({
  status,
  counting,
  countingSince,
  today,
  onOpenSettings,
}: {
  status: "loading" | "empty" | "quiet" | "error" | "ready";
  counting: boolean | null;
  countingSince: string | null;
  today: string;
  onOpenSettings: () => void;
}) {
  const settingsLink = (
    <button type="button" onClick={onOpenSettings} className="st-focus rounded font-medium underline underline-offset-2 hover:text-text">
      Settings
    </button>
  );
  if (status === "empty") {
    return (
      <p className="mt-6 max-w-[40rem] text-text-muted">
        {IS_DEMO ? (
          "Plays show up here once Locally has counted some. The demo counts none."
        ) : counting === false ? (
          <>
            Play counting is off. Turn it on in {settingsLink}.
          </>
        ) : (
          <>Plays show up here once Locally has counted some, from the tracks you play in Spotify on this Mac.</>
        )}
      </p>
    );
  }
  if (status === "loading" || status === "error" || IS_DEMO || counting === null) return null;
  return (
    <p className="mt-2 text-[13px] text-text-muted">
      {countingLine(counting, countingSince, today)}
      {counting ? "" : <> Turn it on in {settingsLink}.</>}
    </p>
  );
}
