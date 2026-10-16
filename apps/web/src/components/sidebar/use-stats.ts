"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaysSummaryResponse, Release } from "../../shared/types";
import { getPlaysSummary } from "../../lib/api-client";
import { IS_DEMO } from "../../lib/demo";
import {
  firstDayForLanguage,
  localDayString,
  msUntilNextLocalMidnight,
  selectionRange,
  type PeriodSelection,
} from "../../lib/play-periods";
import { DEFAULT_PERIOD, TOP_COUNT, aggregatePlays, type PlayStats, type StatsPeriod } from "../../lib/play-stats";
import { DEFAULT_WIDGETS, toggleWidget, type WidgetKey, type WidgetState } from "../../lib/sidebar-panel";
import { keepRecent } from "../../lib/stats-layout";
import { loadSidebarPrefs, saveSidebarPeriod, saveSidebarWidgets } from "../../lib/sidebar-prefs";

/** A period's plays already read are reused for this long; opening the panel again after it reads them again. */
const STALE_MS = 60_000;

export type StatsState =
  | { status: "loading" }
  /** No plays to show at all: play counting is off, nothing has been counted yet, or this is the demo. */
  | { status: "empty" }
  /** Nothing in this period, but plays were counted before it. */
  | { status: "quiet" }
  /** The read failed and there is nothing older to show. It is tried again the next time the panel opens. */
  | { status: "error" }
  | { status: "ready"; stats: PlayStats };

const LOADING: StatsState = { status: "loading" };
const EMPTY: StatsState = { status: "empty" };
const QUIET: StatsState = { status: "quiet" };
const FAILED: StatsState = { status: "error" };

/** What one period's request gave, and the dates it was for: after midnight those are not today's. */
type Read = { status: "ok"; dates: string; summary: PlaysSummaryResponse } | { status: "error" };

/**
 * Today's date on the Mac (`YYYY-MM-DD`), kept current while the sidebar is mounted: it changes at
 * the next local midnight (one timeout, set again each time it fires) and is looked at again when
 * the window gets focus or the page becomes visible again, which also covers a Mac that slept
 * through midnight. `focuses` counts those returns, so a pinned panel that has been out of sight
 * can read again.
 */
export function useLocalDay(): { day: string; focuses: number } {
  const [clock, setClock] = useState(() => ({ day: localDayString(new Date()), focuses: 0 }));

  useEffect(() => {
    let timer: number | undefined;
    const look = (returned: boolean) => {
      const day = localDayString(new Date());
      setClock((prev) =>
        day === prev.day && !returned ? prev : { day, focuses: prev.focuses + (returned ? 1 : 0) },
      );
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        look(false);
        arm();
      }, msUntilNextLocalMidnight(new Date()));
    };
    const onReturn = () => {
      look(true);
      arm(); // a timer that ran while the Mac slept may be off
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onReturn();
    };
    arm();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return clock;
}

/** What {@link usePlayStats} gives: the state to show, and when day counting began on this Mac (null until a read arrives, or when no day is recorded). */
export interface PlayStatsRead {
  state: StatsState;
  countingSince: string | null;
  /** True when the plays include other devices' (signed in, the service's summary merged in). */
  allDevices: boolean;
  /** The Mac's local date the read is for. */
  today: string;
  /** The week's first day (1 Monday to 7 Sunday) the dates were worked out with. */
  firstDay: number;
}

/**
 * The play rankings for a period (#203 for the sidebar, #145 for the Stats page).
 *
 * Each (period, step) is one local `GET /api/plays/summary` for its dates (lib/play-periods, in
 * the Mac's local time, the week starting on the browser language's first day), asked for per
 * period and step: the answer is kept for a minute, and another period keeps its own. Nothing is
 * requested until `active` (the panel or page is showing); a request that fails is not repeated
 * until the next time it is active, or the period is chosen again. When the day changes, or the
 * window comes back to the front after a minute, a showing view reads again; plays read for an
 * earlier day are never shown as today's. The demo has no plays and asks for none. The summary's
 * `allTime` tells an empty period from no plays at all. `limit` is how many of each list to rank.
 */
export function usePlayStats(
  selection: PeriodSelection,
  releases: Release[],
  active: boolean,
  limit: number = TOP_COUNT,
): PlayStatsRead {
  const { day, focuses } = useLocalDay();
  const [reads, setReads] = useState<Partial<Record<string, Read>>>({});
  const key = `${selection.kind}:${selection.back}`;
  /** When each period was last read, and for which dates (a new day is a new read). */
  const readAt = useRef<Partial<Record<string, { dates: string; at: number }>>>({});
  /** The dates each period's latest request is for, while it is out. */
  const inFlight = useRef<Partial<Record<string, string>>>({});
  const mounted = useRef(true);
  const firstDay = useMemo(
    () => firstDayForLanguage(typeof navigator === "undefined" ? undefined : navigator.language),
    [],
  );
  const { from, to } = selectionRange({ kind: selection.kind, back: selection.back }, day, firstDay);
  const dates = `${from}..${to}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `focuses` is a dependency only to look again when the window returns; the staleness check decides.
  useEffect(() => {
    if (!active || IS_DEMO || inFlight.current[key] === dates) return;
    const last = readAt.current[key];
    if (last && last.dates === dates && Date.now() - last.at <= STALE_MS) return;
    inFlight.current[key] = dates;
    // A failed read that is being tried again shows as loading, not as the old error.
    setReads((prev) => {
      if (prev[key]?.status !== "error") return prev;
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    getPlaysSummary(from, to)
      .then((summary) => {
        if (inFlight.current[key] !== dates) return; // a newer day's request took over
        readAt.current[key] = { dates, at: Date.now() };
        if (mounted.current) {
          setReads((prev) => {
            const { next, evicted } = keepRecent(prev, key, { status: "ok", dates, summary } as Read);
            // An evicted period is read again when it is opened, not shown as loading for good.
            for (const k of evicted) delete readAt.current[k];
            return next;
          });
        }
      })
      .catch(() => {
        if (inFlight.current[key] !== dates) return;
        // Plays read earlier for these dates stay on screen; with none, say so. Either way the
        // next open asks again.
        delete readAt.current[key];
        if (mounted.current) {
          setReads((prev) => {
            const kept = prev[key];
            return kept?.status === "ok" && kept.dates === dates ? prev : { ...prev, [key]: { status: "error" } };
          });
        }
      })
      .finally(() => {
        if (inFlight.current[key] === dates) delete inFlight.current[key];
      });
  }, [active, key, dates, from, to, focuses]);

  const read = reads[key];
  const isAll = selection.kind === "all";
  const state = useMemo<StatsState | null>(() => {
    if (read?.status !== "ok") return null;
    // All time ranks the summary's all-time counts; the days it still has only say when a track was last played.
    const lastDays = new Map(read.summary.tracks.map((t) => [t.trackId, t.lastPlayedDay]));
    const counts = isAll
      ? read.summary.allTime.map((t) => ({ ...t, lastPlayedDay: lastDays.get(t.trackId) }))
      : read.summary.tracks;
    const stats = aggregatePlays(releases, counts, limit);
    if (stats.total > 0) return { status: "ready", stats };
    // A limit of 0 ranks nothing: only the total is wanted.
    return aggregatePlays(releases, read.summary.allTime, 0).total > 0 ? QUIET : EMPTY;
  }, [releases, read, limit, isAll]);

  const countingSince = read?.status === "ok" ? (read.summary.countingSince ?? null) : null;
  const allDevices = read?.status === "ok" && read.summary.includesOtherDevices === true;
  let current: StatsState;
  if (IS_DEMO || releases.length === 0) current = EMPTY;
  else if (!read) current = LOADING;
  else if (read.status === "error") current = FAILED;
  // Plays read for an earlier day wait for the new read.
  else current = read.dates === dates ? (state ?? LOADING) : LOADING;
  return { state: current, countingSince, allDevices, today: day, firstDay };
}

/** The play rankings for the sidebar widgets (#203): the top three for Today, This week or This month. */
export function useStats(period: StatsPeriod, releases: Release[], active: boolean): StatsState {
  return usePlayStats({ kind: period, back: 0 }, releases, active).state;
}

/** The chosen period, remembered (lib/sidebar-prefs). This week until a saved one loads. */
export function usePeriod() {
  const [period, setPeriod] = useState<StatsPeriod>(DEFAULT_PERIOD);

  // The saved period loads after mount so the server and first client render agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(loadSidebarPrefs().period);
  }, []);

  const choose = useCallback((next: StatsPeriod) => {
    setPeriod(next);
    saveSidebarPeriod(next);
  }, []);

  return { period, choose };
}

/** Which widgets show, remembered (lib/sidebar-prefs). At least one always stays on. */
export function useWidgets() {
  const [widgets, setWidgets] = useState<WidgetState>(DEFAULT_WIDGETS);

  // Saved prefs load after mount so the server and first client render agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidgets(loadSidebarPrefs().widgets);
  }, []);

  const toggle = useCallback(
    (key: WidgetKey) => {
      const next = toggleWidget(widgets, key);
      if (next === widgets) return;
      setWidgets(next);
      saveSidebarWidgets(next);
    },
    [widgets],
  );

  return { widgets, toggle };
}
