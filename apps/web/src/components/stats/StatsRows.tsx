"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { lastPlayedAtLabel, medalFor, type StatItem } from "../../lib/play-stats";
import { formatCount, lastPlayedLabel, playsCount } from "../../lib/stats-copy";
import { moreLabel, nextShown, seaTiers } from "../../lib/stats-layout";
import StatCover, { statCoverUrl } from "../sidebar/StatCover";
import ArtistLinks from "../ArtistNav";
import { splitFeaturing } from "../../lib/artist-names";

/** The ranked list and the sorted sea under the fan on the Stats page (#145). Each row and each
 * tile is a real button: it opens the release, or for an artist their releases in the Library. */

/** The last-played text of a row: day and time when the play has a time, else the day. It wraps to a second line rather than clip. */
function lastLabel(item: StatItem, today: string): string {
  return item.lastPlayedAt !== null ? lastPlayedAtLabel(item.lastPlayedAt, today) : lastPlayedLabel(item.lastPlayedDay, today);
}

/** What opening an item does, for the tooltip. */
function openHint(item: StatItem): string {
  return item.releaseId ? "Open release" : "Open artist";
}

/** Shows the first page of `total`, and a button for the next. When the last page is shown the
 * button goes, so focus moves to the first row that appeared (`firstNew` finds it in the list). */
function usePaging(
  total: number,
  firstNew: (index: number) => HTMLElement | null | undefined,
  initialShown: number,
  onShownChange: (shown: number) => void
) {
  const [shown, setShown] = useState(initialShown);
  // AppShell remembers the count, so Back to this page shows the same rows (#258).
  useEffect(() => onShownChange(shown), [shown, onShownChange]);
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (focusAt.current === null) return;
    firstNew(focusAt.current)?.focus();
    focusAt.current = null;
  });
  const more = () => {
    const next = nextShown(shown, total);
    if (next >= total) focusAt.current = shown;
    setShown(next);
  };
  const button =
    shown < total ? (
      <button type="button" className="btn-ink mt-4" onClick={more}>
        {moreLabel(shown, total)}
      </button>
    ) : null;
  return { shown, button };
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
  linkArtists,
  trackRows = false,
  onOpen,
  initialShown,
  onShownChange,
}: {
  items: StatItem[];
  label: string;
  round: boolean;
  today: string;
  /** The subtitle is the artist's name (Tracks and Albums): each name opens that artist's page (#288). */
  linkArtists: boolean;
  /** Tracks ranking: "Song (feat. Guest)" shows the plain title and Guest joins the artist line as a link. */
  trackRows?: boolean;
  onOpen: (item: StatItem) => void;
  initialShown: number;
  onShownChange: (shown: number) => void;
}) {
  const max = Math.max(0, ...items.map((i) => i.plays));
  const list = useRef<HTMLOListElement>(null);
  const { shown, button } = usePaging(items.length, (i) => list.current?.querySelectorAll<HTMLElement>("[data-row-open]")[i], initialShown, onShownChange);
  return (
    <div className="st-list">
      <ol ref={list} aria-label={label} className="mt-3">
        {items.slice(0, shown).map((item) => (
          <li key={item.id}>
            {/* A div, not a button: the artist names inside are links, and a link can't sit in a button. The
                title is the keyboard stop; a click anywhere else on the row opens it too. */}
            <div className="st-row" onClick={() => onOpen(item)}>
              <span className="st-rank text-center text-sm font-semibold tabular-nums text-text-muted" data-medal={medalFor(item.rank)}>
                {item.rank}
              </span>
              <StatCover cover={item.cover} round={round} className="h-11 w-11 shadow-[0_8px_18px_-8px_rgb(0_0_0/0.7)]" />
              <span className="min-w-0">
                <button
                  type="button"
                  data-row-open
                  title={openHint(item)}
                  className="medal-name st-focus block max-w-full truncate rounded-lg text-left text-[15px] font-semibold"
                  data-medal={medalFor(item.rank)}
                >
                  {trackRows ? splitFeaturing(item.title).title : item.title}
                </button>
                <span className="block truncate text-sm text-text-muted">
                  {linkArtists && item.subtitle.trim() !== "" ? <ArtistLinks artist={item.subtitle} featuring={trackRows ? splitFeaturing(item.title).featuring : []} /> : item.subtitle}
                </span>
              </span>
              <span className="st-row-last text-left text-sm text-text-muted" title={lastLabel(item, today)}>
                {lastLabel(item, today)}
              </span>
              <span className="st-row-bar flex items-center gap-3">
                <PlayBar plays={item.plays} max={max} />
              </span>
              <span className="st-row-total text-right text-[15px] font-semibold tabular-nums" title={playsCount(item.plays)}>
                {formatCount(item.plays)}
                <span className="sr-only">{item.plays === 1 ? " play" : " plays"}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
      {button}
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
              <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
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
          <span
            className={`medal-name block truncate font-semibold ${tier === 0 ? "text-sm" : tier === 1 ? "text-[13px]" : "text-xs"}`}
            data-medal={medalFor(item.rank)}
          >
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
  initialShown,
  onShownChange,
}: {
  items: StatItem[];
  label: string;
  round: boolean;
  onOpen: (item: StatItem) => void;
  initialShown: number;
  onShownChange: (shown: number) => void;
}) {
  const wrap = useRef<HTMLElement>(null);
  const { shown, button } = usePaging(items.length, (i) => wrap.current?.querySelectorAll<HTMLElement>("button")[i], initialShown, onShownChange);
  const groups = seaTiers(items.slice(0, shown));
  return (
    <section ref={wrap} aria-label={label} className="st-sea-wrap mt-4">
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
      {button}
    </section>
  );
}
