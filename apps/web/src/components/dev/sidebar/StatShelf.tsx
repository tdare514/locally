"use client";

import { useState, type CSSProperties } from "react";
import { Choice, focusRing } from "./controls";
import { KINDS, medalFor, topFor, type Period, type StatItem, type StatKind } from "./sample-data";
import { useCovers } from "./use-stats";

/** Where each rank sits across the fan, left to right: number one in the middle with silver on its
 * left and bronze on its right, like a podium. The DOM stays in rank order for the keyboard. */
const SLOT_OF_RANK = [1, 0, 2];

/**
 * The optional "Stats shelf" widget (#154 prototype): the top three as overlapping record sleeves
 * that fan out, with a Tracks / Albums / Artists switch above. The active sleeve (hovered, focused,
 * else number one) lifts and shows its title and plays; its record slides out of the top. The
 * first three carry a gold, silver and bronze rim.
 */
export default function StatShelf({ period }: { period: Period }) {
  const [kind, setKind] = useState<StatKind>("tracks");
  const covers = useCovers();
  const items = topFor(kind, period);
  const [active, setActive] = useState(0);
  const title = KINDS.find((k) => k.key === kind)?.title ?? "";

  return (
    <section aria-label="Stats shelf">
      <Choice
        kind="tabs"
        label="Show top"
        value={kind}
        options={KINDS.map((k) => ({ value: k.key, label: k.tab }))}
        onChange={(next) => {
          setKind(next);
          setActive(0);
        }}
        className="ml-1.5"
      />
      <div className="sb-shelf" onPointerLeave={() => setActive(0)}>
        <div aria-hidden className="sb-ground" />
        <ol aria-label={`${title}, most played first`} className="contents">
          {items.map((item, i) => (
            <Sleeve
              key={item.id}
              item={item}
              index={i}
              cover={covers[item.coverId]}
              disc={kind === "artists"}
              active={i === active}
              onActive={() => setActive(i)}
            />
          ))}
        </ol>
        <div aria-hidden className="sb-plank" />
      </div>
    </section>
  );
}

function Sleeve({
  item,
  index,
  cover,
  disc,
  active,
  onActive,
}: {
  item: StatItem;
  index: number;
  cover: string | undefined;
  /** Artists are round, with no record behind them. */
  disc: boolean;
  active: boolean;
  onActive: () => void;
}) {
  const offset = SLOT_OF_RANK[index] - 1;
  const style = {
    // --a tilts the sleeve, --k orders the fan-out from the middle outwards.
    "--a": `${offset * 12}deg`,
    "--k": Math.abs(offset),
    zIndex: active ? 10 : 5 - Math.abs(offset),
  } as CSSProperties;
  return (
    <li
      className="sb-sleeve"
      data-active={active}
      data-shape={disc ? "disc" : "sleeve"}
      data-side={offset < 0 ? "left" : "right"}
      style={style}
    >
      <button
        type="button"
        onPointerEnter={onActive}
        onFocus={onActive}
        aria-label={`${item.rank}. ${item.title}, ${item.subtitle}, ${item.plays} plays`}
        className={`sb-hit rounded-lg ${focusRing}`}
      >
        {!disc && (
          <span aria-hidden className="sb-record">
            <span className="sb-record-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI */}
        <img src={cover} alt="" data-medal={medalFor(item.rank)} className="sb-art" />
        <span aria-hidden className="sb-rank" data-medal={medalFor(item.rank)}>
          {item.rank}
        </span>
        <span aria-hidden className="sb-tag">
          <span className="line-clamp-2 text-xs font-semibold leading-tight text-white">{item.title}</span>
          <span className="block text-[11px] tabular-nums text-white/75">{item.plays} plays</span>
        </span>
      </button>
    </li>
  );
}
