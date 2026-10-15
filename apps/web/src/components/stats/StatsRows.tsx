"use client";

import type { CSSProperties } from "react";
import { medalFor, type StatItem } from "../../lib/play-stats";
import { formatCount, lastPlayedLabel, playsCount } from "../../lib/stats-copy";
import { seaTiers } from "../../lib/stats-layout";
import StatCover, { statCoverUrl } from "../sidebar/StatCover";

/** The ranked list and the sorted sea under the fan on the Stats page (#145). Each row and each
 * tile is a real button: it opens the release, or for an artist their releases in the Library. */

/** What opening an item does, for the tooltip. */
function openHint(item: StatItem): string {
  return item.releaseId ? "Open release" : "Show in Library";
}

function PlayBar({ plays, max }: { plays: number; max: number }) {
  const pct = max > 0 ? Math.max(plays > 0 ? 3 : 0, Math.round((plays / max) * 100)) : 0;
  return (
    <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
      <div className="st-bar h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Rows keep their plays rank under any sort. The first three are tinted gold, silver and bronze,
 * like the fan's rims. The bar is scaled to the most-played row in view. At a narrow width the
 * last played and bar columns drop (container query in globals.css). */
export function StatsList({
  items,
  label,
  round,
  today,
  onOpen,
}: {
  items: StatItem[];
  label: string;
  round: boolean;
  today: string;
  onOpen: (item: StatItem) => void;
}) {
  const max = Math.max(0, ...items.map((i) => i.plays));
  return (
    <div className="st-list">
      <ol aria-label={label} className="mt-3">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="st-row st-focus" title={openHint(item)} onClick={() => onOpen(item)}>
              <span className="st-rank text-center text-sm font-semibold tabular-nums text-text-muted" data-medal={medalFor(item.rank)}>
                {item.rank}
              </span>
              <StatCover cover={item.cover} round={round} className="h-11 w-11 shadow-[0_8px_18px_-8px_rgb(0_0_0/0.7)]" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{item.title}</span>
                <span className="block truncate text-sm text-text-muted">{item.subtitle}</span>
              </span>
              <span className="st-row-last truncate text-sm text-text-muted">{lastPlayedLabel(item.lastPlayedDay, today)}</span>
              <span className="st-row-bar flex items-center gap-3">
                <PlayBar plays={item.plays} max={max} />
              </span>
              <span className="st-row-total text-right text-[15px] font-semibold tabular-nums" title={playsCount(item.plays)}>
                {formatCount(item.plays)}
                <span className="sr-only">{item.plays === 1 ? " play" : " plays"}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** How each tier of the sea shows its covers: what sits under the picture. */
const CAPTIONS = ["full", "name", "name"] as const;

function Tile({ item, tier, round, onOpen }: { item: StatItem; tier: number; round: boolean; onOpen: (item: StatItem) => void }) {
  const url = statCoverUrl(item.cover);
  const caption = CAPTIONS[tier];
  return (
    <li className="min-w-0">
      <button
        type="button"
        className="st-tile st-focus"
        title={`${item.title}, ${playsCount(item.plays)}. ${openHint(item)}`}
        onClick={() => onOpen(item)}
      >
        <span className="st-lift relative block">
          <span
            className={`relative block aspect-square w-full overflow-hidden bg-card ${
              round ? "st-disc" : "record-sleeve rounded-[4px]"
            }`}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local cover route, no optimisation needed
              <img src={url} alt="" draggable={false} className="size-full object-cover" />
            ) : (
              <span className="block size-full bg-elevated" />
            )}
          </span>
          <span
            aria-hidden
            className={`st-chip left-1.5 top-1.5 ${round ? "!left-[9%] !top-[9%]" : ""}`}
          >
            {item.rank}
          </span>
          <span aria-hidden className={`st-chip bottom-1.5 right-1.5 ${round ? "!bottom-[9%] !right-[9%]" : ""}`}>
            {tier === 2 ? formatCount(item.plays) : playsCount(item.plays)}
          </span>
        </span>
        <span className="mt-2 block text-left">
          <span className={`block truncate font-semibold ${tier === 0 ? "text-sm" : tier === 1 ? "text-[13px]" : "text-xs"}`}>
            {item.title}
          </span>
          {caption === "full" && <span className="block truncate text-[13px] text-text-muted">{item.subtitle}</span>}
        </span>
        {/* The chips are hidden from screen readers; the button's name carries the rank and plays. */}
        <span className="sr-only">
          {item.rank}, {item.subtitle}, {playsCount(item.plays)}
        </span>
      </button>
    </li>
  );
}

/** The sorted sea: covers sized by plays, in rank order, in three sizes that step down. Each size
 * is its own grid whose columns come from the room it has (globals.css), so nothing overlaps at any
 * width and a tile is never under 72px. */
export function StatsSea({
  items,
  label,
  round,
  onOpen,
}: {
  items: StatItem[];
  label: string;
  round: boolean;
  onOpen: (item: StatItem) => void;
}) {
  const groups = seaTiers(items);
  return (
    <section aria-label={label} className="st-sea-wrap mt-4">
      <p className="text-sm text-text-muted">Ranked by plays, left to right. Bigger covers have more plays.</p>
      <div className="mt-5 space-y-9">
        {groups.map((group, tier) => (
          <ol key={tier} className="st-sea" data-tier={tier} style={{ "--tier": tier } as CSSProperties}>
            {group.map((item) => (
              <Tile key={item.id} item={item} tier={tier} round={round} onOpen={onOpen} />
            ))}
          </ol>
        ))}
      </div>
    </section>
  );
}
