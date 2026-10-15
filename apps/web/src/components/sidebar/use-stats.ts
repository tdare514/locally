"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Release } from "../../shared/types";
import { getReleasePlays } from "../../lib/api-client";
import { IS_DEMO } from "../../lib/demo";
import {
  aggregatePlays,
  fetchPlaysForReleases,
  type PlaysByRelease,
  type PlayStats,
  type StatsPeriod,
} from "../../lib/play-stats";
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
  | { status: "ready"; stats: PlayStats };

const LOADING: StatsState = { status: "loading" };
const EMPTY: StatsState = { status: "empty" };

/**
 * The play rankings for the sidebar widgets.
 *
 * Only the "all" period can be read today: `GET /api/plays` answers one release at a time with
 * all-time totals, and there are no per-day counts yet (#193). Any other period reads as empty
 * until that data exists. Nothing is requested until `active` (the panel is showing), then each
 * release is asked for at a few at a time and kept for a minute; releases added since are the
 * only ones asked for again within that minute. The demo has no plays and asks for none.
 */
export function useStats(period: StatsPeriod, releases: Release[], active: boolean): StatsState {
  const [plays, setPlays] = useState<PlaysByRelease | null>(null);
  const have = useRef<PlaysByRelease>({});
  const readAt = useRef(0);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const idsKey = releases.map((r) => r.id).join(",");
  const readable = period === "all" && !IS_DEMO;

  useEffect(() => {
    if (!active || !readable || idsKey === "") return;
    const stale = Date.now() - readAt.current > STALE_MS;
    const wanted = idsKey
      .split(",")
      .filter((id) => !inFlight.current.has(id) && (stale || !(id in have.current)));
    if (wanted.length === 0) return;
    for (const id of wanted) inFlight.current.add(id);
    fetchPlaysForReleases(wanted, getReleasePlays)
      .then((got) => {
        have.current = { ...have.current, ...got };
        readAt.current = Date.now();
        if (mounted.current) setPlays(have.current);
      })
      .finally(() => {
        for (const id of wanted) inFlight.current.delete(id);
      });
  }, [active, readable, idsKey]);

  const stats = useMemo(() => aggregatePlays(releases, plays ?? {}), [releases, plays]);

  if (!readable || releases.length === 0) return EMPTY;
  if (plays === null) return LOADING;
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
