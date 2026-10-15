"use client";

import type { CSSProperties } from "react";
import { MusicNoteIcon } from "../../Icons";
import type { Ns } from "./controls";
import { medalFor, topFor, WIDGETS, type Period, type StatItem, type WidgetKey } from "./sample-data";
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
 * The stat widgets (#154 prototype): one ranked top-five per switched-on widget. Each row has a
 * quiet bar behind it showing its plays against the leader. `rows` is a uniform list with a small
 * cover on one line; `lead` gives the number one a larger cover and sets the rest as plain text.
 */
export default function StatList({
  ns,
  period,
  enabled,
  variant,
}: {
  ns: Ns;
  period: Period;
  enabled: Record<WidgetKey, boolean>;
  variant: "rows" | "lead";
}) {
  const shown = WIDGETS.filter((w) => enabled[w.key]);
  if (shown.length === 0) {
    return <p className="px-1.5 py-2 text-xs text-text-muted">No widgets on. Use Edit widgets to add one.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {shown.map((w, wi) => {
        const items = topFor(w.key, period);
        const top = items[0]?.plays || 1;
        return (
          <section key={w.key} aria-label={w.title}>
            <h3 className="px-1.5 pb-1 text-xs font-semibold text-text-soft">{w.title}</h3>
            <ol className="flex flex-col">
              {items.map((item, i) => (
                <Row
                  key={i}
                  ns={ns}
                  item={item}
                  round={w.key === "artists"}
                  look={variant === "rows" ? "compact" : i === 0 ? "lead" : "plain"}
                  share={item.plays / top}
                  order={wi * 5 + i}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** compact: a small cover and the title on one line. lead: a larger cover with the subtitle under
 * the title. plain: the title alone. The subtitle is always there for screen readers. */
function Row({
  ns,
  item,
  round,
  look,
  share,
  order,
}: {
  ns: Ns;
  item: StatItem;
  round: boolean;
  look: "compact" | "lead" | "plain";
  share: number;
  order: number;
}) {
  const medal = medalFor(item.rank);
  const lead = look === "lead";
  return (
    <li
      className={`${ns}-row relative flex items-center gap-2.5 rounded-xl px-1.5 ${lead ? "py-1" : "py-0.5"}`}
      style={{ "--w": share, "--d": order } as CSSProperties}
    >
      <span aria-hidden className={`${ns}-bar`} />
      <span
        data-medal={medal}
        className={`relative w-4 shrink-0 text-center text-xs font-bold tabular-nums text-text-dim ${medalText}`}
      >
        {item.rank}
      </span>
      {/* Keyed by the item, so a row whose item changes with the period fades its new content in. */}
      <span key={item.id} className={`${ns}-swap relative flex min-w-0 flex-1 items-center gap-2.5`}>
        {look !== "plain" && <Cover id={item.coverId} round={round} className={lead ? "h-10 w-10" : "h-7 w-7"} />}
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
