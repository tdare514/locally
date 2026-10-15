"use client";

import { useMemo, useState } from "react";
import { useArtworkPalette } from "../../../lib/use-artwork-palette";
import AmbientBackdrop from "../../AmbientBackdrop";
import { CoversContext, DevStrip, FooterNotes, vars } from "./parts";
import StatsView from "./StatsView";
import { rankedRows, type Period, type SortKey, type Tab, type View } from "./sample-data";

/**
 * Root of the #145 Stats page prototype. It owns the state the page shares (group, sort, time
 * frame, list or grid) and colours the AmbientBackdrop by the cover of whatever is #1 in the
 * current view, as the release page does for its cover.
 */
export default function StreamsPrototype({
  initialTab,
  initialSort,
  initialPeriod,
  initialView,
  covers,
}: {
  initialTab: Tab;
  initialSort: SortKey;
  initialPeriod: Period;
  initialView: View;
  covers: Record<string, string>;
}) {
  const [tab, setTab] = useState(initialTab);
  const [sort, setSort] = useState(initialSort);
  const [period, setPeriod] = useState(initialPeriod);
  const [view, setView] = useState(initialView);

  const lead = useMemo(() => rankedRows(tab, period)[0], [tab, period]);
  const palette = useArtworkPalette(covers[lead.coverId] ?? null);

  return (
    <CoversContext.Provider value={covers}>
      <div
        className="st-root relative isolate min-h-screen overflow-x-clip pb-16"
        style={palette ? vars({ "--btn-tint": palette.primary }) : undefined}
      >
        <AmbientBackdrop palette={palette} />
        <DevStrip />
        <StatsView
          tab={tab}
          setTab={setTab}
          sort={sort}
          setSort={setSort}
          period={period}
          setPeriod={setPeriod}
          view={view}
          setView={setView}
        />
        <FooterNotes />
      </div>
    </CoversContext.Provider>
  );
}
