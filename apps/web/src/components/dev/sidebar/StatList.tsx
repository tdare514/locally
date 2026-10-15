"use client";

import type { CSSProperties } from "react";
import { MusicNoteIcon } from "../../Icons";
import { KINDS, medalFor, topFor, type Period, type StatItem, type WidgetKey } from "./sample-data";
import { useCovers } from "./use-stats";

const medalText =
  "data-[medal=gold]:text-[#e4c46a] data-[medal=silver]:text-[#c9ced6] data-[medal=bronze]:text-[#d08f52]";

function Cover({ id, round, className }: { id: string; round: boolean; className: string }) {
  const src = useCovers()[id];
  const shape = round ? "rounded-full" : "rounded-md";
  if (!src) {
    return (
      <span className={`flex shrink-0 items-center justify-center bg-white/[0.08] text-text-muted ${shape} ${className}`}>
        <MusicNoteIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI, no optimisation needed
    <img src={src} alt="" className={`shrink-0 object-cover ${shape} ${className}`} />
  );
}

function Plays({ n }: { n: number }) {
  return (
    <span className="relative shrink-0 pl-1 text-xs font-semibold tabular-nums text-text-soft">
      {n}
      <span className="sr-only"> plays</span>
    </span>
  );
}

/**
 * The list widgets (#154 prototype): a ranked top three for each of Top tracks, Top albums and Top
 * artists that is switched on. Each row has a quiet bar behind it showing its plays against the
 * leader. The number one gets a larger cover and its subtitle; the rest are plain text.
 */
export default function StatList({ period, enabled }: { period: Period; enabled: Record<WidgetKey, boolean> }) {
  const shown = KINDS.filter((k) => enabled[k.key]);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((k, ki) => {
        const items = topFor(k.key, period);
        const top = items[0]?.plays || 1;
        return (
          <section key={k.key} aria-label={k.title}>
            <h3 className="px-1.5 pb-1 text-xs font-semibold text-text-soft">{k.title}</h3>
            <ol className="flex flex-col">
              {items.map((item, i) => (
                <Row
                  key={i}
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
      className={`sb-row relative flex items-center gap-2.5 rounded-xl px-1.5 ${lead ? "py-1" : "py-0.5"}`}
      style={{ "--w": share, "--d": order } as CSSProperties}
    >
      <span aria-hidden className="sb-bar" />
      <span
        data-medal={medal}
        className={`relative w-4 shrink-0 text-center text-xs font-bold tabular-nums text-text-dim ${medalText}`}
      >
        {item.rank}
      </span>
      {/* Keyed by the item, so a row whose item changes with the period fades its new content in. */}
      <span key={item.id} className="sb-swap relative flex min-w-0 flex-1 items-center gap-2.5">
        {lead && <Cover id={item.coverId} round={round} className="h-10 w-10" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${lead ? "text-sm font-semibold" : "text-[13px] font-medium"} text-text`}>
            {item.title}
          </span>
          <span className={lead ? "block truncate text-[11px] text-text-muted" : "sr-only"}>{item.subtitle}</span>
        </span>
      </span>
      <Plays n={item.plays} />
    </li>
  );
}
