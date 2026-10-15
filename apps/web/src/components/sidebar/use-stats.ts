"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayTotal, Release } from "../../shared/types";
import { getPlayTotals } from "../../lib/api-client";
import { IS_DEMO } from "../../lib/demo";
import { aggregatePlays, type PlayStats, type StatsPeriod } from "../../lib/play-stats";
import { DEFAULT_WIDGETS, toggleWidget, type WidgetKey, type WidgetState } from "../../lib/sidebar-panel";
import { loadSidebarPrefs, saveSidebarWidgets } from "../../lib/sidebar-prefs";
import { HAS_DAILY_COUNTS } from "./flags";

/** The period the panel starts on: this week once daily counts exist, else all time. */
export const DEFAULT_PERIOD: StatsPeriod = HAS_DAILY_COUNTS ? "week" : "all";

/** Counts already read are reused for this long; opening the panel again after it reads them again. */
const STALE_MS = 60_000;

export type StatsState =
  | { status: "loading" }
  /** No plays to show: play counting is off, nothing has been counted yet, or this is the demo. */
  | { status: "empty" }
  /** The read failed and there is nothing older to show. It is tried again the next time the panel opens. */
  | { status: "error" }
  | { status: "ready"; stats: PlayStats };

const LOADING: StatsState = { status: "loading" };
const EMPTY: StatsState = { status: "empty" };
const FAILED: StatsState = { status: "error" };

type Read = { status: "none" } | { status: "ok"; totals: PlayTotal[] } | { status: "error" };

/**
 * The play rankings for the sidebar widgets.
 *
 * Only the "all" period can be read today, and only this Mac's plays: `GET /api/plays/totals` is
 * one local request for every track's all-time count. There are no per-day counts yet (#193), so any
 * other period reads as empty until that data exists. Nothing is requested until `active` (the
 * panel is showing); the answer is kept for a minute, and a request that fails is not repeated
 * until the next time the panel opens. The demo has no plays and asks for none.
 */
export function useStats(period: StatsPeriod, releases: Release[], active: boolean): StatsState {
  const [read, setRead] = useState<Read>({ status: "none" });
  const readAt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readable = period === "all" && !IS_DEMO;

  useEffect(() => {
    if (!active || !readable || inFlight.current) return;
    if (readAt.current !== null && Date.now() - readAt.current <= STALE_MS) return;
    inFlight.current = true;
    getPlayTotals()
      .then(({ tracks }) => {
        readAt.current = Date.now();
        if (mounted.current) setRead({ status: "ok", totals: tracks });
      })
      .catch(() => {
        // Counts read earlier stay on screen; with none, say so. Either way the next open asks again.
        readAt.current = null;
        if (mounted.current) setRead((prev) => (prev.status === "ok" ? prev : { status: "error" }));
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [active, readable]);

  const stats = useMemo(
    () => aggregatePlays(releases, read.status === "ok" ? read.totals : []),
    [releases, read],
  );

  if (!readable || releases.length === 0) return EMPTY;
  if (read.status === "none") return LOADING;
  if (read.status === "error") return FAILED;
  return stats.total > 0 ? { status: "ready", stats } : EMPTY;
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
