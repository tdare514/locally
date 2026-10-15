"use client";

import { useMemo, useState } from "react";
import { useArtworkPalette } from "../../../lib/use-artwork-palette";
import AmbientBackdrop from "../../AmbientBackdrop";
import DirectionA from "./DirectionA";
import DirectionB from "./DirectionB";
import DirectionC from "./DirectionC";
import { CoversContext, DevStrip, FooterNotes } from "./parts";
import {
  digestFor,
  rankedRows,
  type PeriodKey,
  type SortKey,
  type Tab,
  type Variant,
} from "./sample-data";

/**
 * Root of the #145 Streams page prototype: one page, three directions (`?v=a|b|c`). It owns the
 * state the directions share (group, sort, period) and colours the AmbientBackdrop by the cover
 * of whatever is #1 in the current view, as the release page does for its cover.
 */
export default function StreamsPrototype({
  variant,
  initialTab,
  initialSort,
  initialPeriod,
  covers,
}: {
  variant: Variant;
  initialTab: Tab;
  initialSort: SortKey;
  initialPeriod: PeriodKey | null;
  covers: Record<string, string>;
}) {
  const [tab, setTab] = useState(initialTab);
  const [sort, setSort] = useState(initialSort);
  const [period, setPeriod] = useState<PeriodKey>(initialPeriod ?? "this-week");

  // A's wash is the week's #1 track whatever the list below is showing; B and C follow the view.
  const lead = useMemo(
    () => (variant === "a" ? digestFor("this-week").tracks[0] : rankedRows(tab, period)[0]),
    [variant, tab, period],
  );
  const palette = useArtworkPalette(covers[lead.coverId] ?? null);

  return (
    <CoversContext.Provider value={covers}>
      <div className="st-root relative isolate min-h-screen overflow-x-clip pb-16">
        <AmbientBackdrop palette={palette} />
        <DevStrip variant={variant} tab={tab} />
        {variant === "a" && (
          <DirectionA tab={tab} setTab={setTab} sort={sort} setSort={setSort} period={period} setPeriod={setPeriod} />
        )}
        {variant === "b" && <DirectionB tab={tab} setTab={setTab} period={period} setPeriod={setPeriod} />}
        {variant === "c" && (
          <DirectionC tab={tab} setTab={setTab} sort={sort} setSort={setSort} period={period} setPeriod={setPeriod} />
        )}
        <FooterNotes />
      </div>
    </CoversContext.Provider>
  );
}
