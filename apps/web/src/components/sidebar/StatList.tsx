"use client";

import type { CSSProperties } from "react";
import { STAT_KINDS, medalFor, type PlayStats, type StatItem } from "../../lib/play-stats";
import type { WidgetState } from "../../lib/sidebar-panel";
import StatCover from "./StatCover";

const medalText =
  "data-[medal=gold]:text-[#e4c46a] data-[medal=silver]:text-[#c9ced6] data-[medal=bronze]:text-[#d08f52]";

function Plays({ n }: { n: number }) {
  return (
    <span className="relative shrink-0 pl-1 text-xs font-semibold tabular-nums text-text-soft">
      {n}
      <span className="sr-only">{n === 1 ? " play" : " plays"}</span>
    </span>
  );
}

/**
 * The list widgets (#154): a ranked top three for each of Top tracks, Top albums and Top artists
 * that is switched on. Each row has a quiet bar behind it showing its plays against the leader.
 * The number one gets a larger cover and its subtitle; the rest are plain text.
 */
export default function StatList({ stats, enabled }: { stats: PlayStats; enabled: WidgetState }) {
  const shown = STAT_KINDS.filter((k) => enabled[k.key] && stats[k.key].length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((k, ki) => {
        const items = stats[k.key];
        const top = items[0]?.plays || 1;
        return (
          <section key={k.key} aria-label={k.title}>
            <h3 className="px-1.5 pb-1 text-xs font-semibold text-text-soft">{k.title}</h3>
            <ol className="flex flex-col">
              {items.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  round={k.key === "artists"}
                  lead={i === 0}
                  share={item.plays / top}
                  order={ki * 3 + i}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** lead: a larger cover with the subtitle under the title. Otherwise the title alone. The subtitle
 * is always there for screen readers. */
function Row({
  item,
  round,
  lead,
  share,
  order,
}: {
  item: StatItem;
  round: boolean;
  lead: boolean;
  share: number;
  order: number;
}) {
  const medal = medalFor(item.rank);
  return (
    <li
      className={`sb-row relative flex items-center gap-2.5 rounded-lg px-1.5 ${lead ? "py-1" : "py-0.5"}`}
      style={{ "--w": share, "--d": order } as CSSProperties}
    >
      <span aria-hidden className="sb-bar" />
      <span
        data-medal={medal}
        className={`relative w-4 shrink-0 text-center text-xs font-bold tabular-nums text-text-muted ${medalText}`}
      >
        {item.rank}
      </span>
      {/* Keyed by the item, so a row whose item changes with the period fades its new content in. */}
      <span key={item.id} className="sb-swap relative flex min-w-0 flex-1 items-center gap-2.5">
        {lead && <StatCover cover={item.cover} round={round} className="h-10 w-10" />}
        <span className="min-w-0 flex-1">
          <span
            data-medal={medal}
            className={`medal-name block truncate ${lead ? "text-sm font-semibold" : "text-[13px] font-medium"} text-text`}
          >
            {item.title}
          </span>
          <span className={lead ? "block truncate text-[11px] text-text-muted" : "sr-only"}>{item.subtitle}</span>
        </span>
      </span>
      <Plays n={item.plays} />
    </li>
  );
}
