"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaysSummaryResponse, Release } from "../../shared/types";
import { getPlaysSummary } from "../../lib/api-client";
import { IS_DEMO } from "../../lib/demo";
import { firstDayForLanguage, periodRange } from "../../lib/play-periods";
import { DEFAULT_PERIOD, aggregatePlays, type PlayStats, type StatsPeriod } from "../../lib/play-stats";
import { DEFAULT_WIDGETS, toggleWidget, type WidgetKey, type WidgetState } from "../../lib/sidebar-panel";
import { loadSidebarPrefs, saveSidebarPeriod, saveSidebarWidgets } from "../../lib/sidebar-prefs";

/** A period's plays already read are reused for this long; opening the panel again after it reads them again. */
const STALE_MS = 60_000;

export type StatsState =
  | { status: "loading" }
  /** No plays to show at all: play counting is off, nothing has been counted yet, or this is the demo. */
  | { status: "empty" }
  /** Nothing in this period, but plays were counted before it (counting by day is new). */
  | { status: "quiet" }
  /** The read failed and there is nothing older to show. It is tried again the next time the panel opens. */
  | { status: "error" }
  | { status: "ready"; stats: PlayStats };

const LOADING: StatsState = { status: "loading" };
const EMPTY: StatsState = { status: "empty" };
const QUIET: StatsState = { status: "quiet" };
const FAILED: StatsState = { status: "error" };

type Read = { status: "ok"; summary: PlaysSummaryResponse } | { status: "error" };

/**
 * The play rankings for the sidebar widgets, for the chosen period (#203).
 *
 * Each period is one local `GET /api/plays/summary` for its dates (lib/play-periods, in the Mac's
 * local time, the week starting on the locale's first day), asked for per period: the answer is kept
 * for a minute, and a different period keeps its own. Nothing is requested until `active` (the panel
 * is showing); a request that fails is not repeated until the next time the panel opens. The demo has
 * no plays and asks for none. The summary's `allTime` tells an empty period from no plays at all.
 */
export function useStats(period: StatsPeriod, releases: Release[], active: boolean): StatsState {
  const [reads, setReads] = useState<Partial<Record<StatsPeriod, Read>>>({});
  /** When each period was last read, and for which dates (a new day is a new read). */
  const readAt = useRef<Partial<Record<StatsPeriod, { dates: string; at: number }>>>({});
  const inFlight = useRef<Partial<Record<StatsPeriod, boolean>>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || IS_DEMO || inFlight.current[period]) return;
    const { from, to } = periodRange(period, new Date(), firstDayForLanguage(navigator.language));
    const dates = `${from}..${to}`;
    const last = readAt.current[period];
    if (last && last.dates === dates && Date.now() - last.at <= STALE_MS) return;
    inFlight.current[period] = true;
    getPlaysSummary(from, to)
      .then((summary) => {
        readAt.current[period] = { dates, at: Date.now() };
        if (mounted.current) setReads((prev) => ({ ...prev, [period]: { status: "ok", summary } }));
      })
      .catch(() => {
        // Plays read earlier stay on screen; with none, say so. Either way the next open asks again.
        delete readAt.current[period];
        if (mounted.current) {
          setReads((prev) => (prev[period]?.status === "ok" ? prev : { ...prev, [period]: { status: "error" } }));
        }
      })
      .finally(() => {
        inFlight.current[period] = false;
      });
  }, [active, period]);

  const read = reads[period];
  const state = useMemo<StatsState | null>(() => {
    if (read?.status !== "ok") return null;
    const stats = aggregatePlays(releases, read.summary.tracks);
    if (stats.total > 0) return { status: "ready", stats };
    // A limit of 0 ranks nothing: only the total is wanted.
    return aggregatePlays(releases, read.summary.allTime, 0).total > 0 ? QUIET : EMPTY;
  }, [releases, read]);

  if (IS_DEMO || releases.length === 0) return EMPTY;
  if (!read) return LOADING;
  if (read.status === "error") return FAILED;
  return state ?? LOADING;
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
