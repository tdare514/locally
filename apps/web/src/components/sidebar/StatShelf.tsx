"use client";

import { useState } from "react";
import { STAT_KINDS, type PlayStats, type StatKind } from "../../lib/play-stats";
import SleeveFan from "../stats/SleeveFan";
import { Choice } from "./controls";

/**
 * The optional "Stats shelf" widget (#154): the top three as overlapping record sleeves that fan out
 * (the shared `SleeveFan`, shelf size), with a Tracks / Albums / Artists switch above. The active
 * sleeve (hovered, focused, else number one) lifts and shows its title and plays; its record
 * slides out of the top. The first three carry a gold, silver and bronze rim.
 */
export default function StatShelf({ stats }: { stats: PlayStats }) {
  const [kind, setKind] = useState<StatKind>("tracks");
  const title = STAT_KINDS.find((k) => k.key === kind)?.title ?? "";

  return (
    <section aria-label="Stats shelf">
      <Choice
        kind="tabs"
        label="Show top"
        value={kind}
        options={STAT_KINDS.map((k) => ({ value: k.key, label: k.tab }))}
        onChange={setKind}
        className="ml-1.5"
      />
      {/* Keyed by the kind, so switching tab puts the lift back on number one. */}
      <SleeveFan
        key={kind}
        items={stats[kind]}
        size="shelf"
        label={`${title}, most played first`}
        disc={kind === "artists"}
      />
    </section>
  );
}
