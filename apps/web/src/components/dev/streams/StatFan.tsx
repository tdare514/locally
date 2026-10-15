"use client";

import { useContext, useState, type CSSProperties } from "react";
import { CoversContext, medalFor } from "./parts";
import { playsLabel, type Row } from "./sample-data";

/**
 * MIRRORS the sidebar prototype's StatShelf (components/dev/sidebar/StatShelf.tsx, #154), at page
 * size and with five sleeves instead of three. Both become one component when the stats are built
 * for real; until then keep the two in step (the CSS is `.st-fan-*` here, `.sb-shelf*` and
 * `.sb-sleeve*` there). What is the same: the top ranks as overlapping record sleeves in a fan,
 * number one in the middle with silver and bronze either side (four and five on the outside), a
 * gold, silver and bronze rim on the first three, and the active sleeve (hovered, focused, else
 * number one) lifting and sliding its record out of the top to show its title and plays. Artists
 * are round discs with no record. What differs: the Tracks / Albums / Artists switch is the page's
 * own, so this takes the rows to show.
 */

/** Where each rank sits across the fan, left to right: number one in the middle, silver on its left
 * and bronze on its right, then four and five on the outside. The DOM stays in rank order for the
 * keyboard. */
const SLOT_OF_RANK = [2, 1, 3, 0, 4];
const MIDDLE_SLOT = 2;
/** How far each step from the middle tilts a sleeve. */
const DEGREES_PER_STEP = 11;

export default function StatFan({ rows, label }: { rows: Row[]; label: string }) {
  const covers = useContext(CoversContext);
  const [active, setActive] = useState(0);
  return (
    <section
      aria-label={label}
      className="st-fan"
      onPointerLeave={() => setActive(0)}
      onBlur={(e) => {
        // Focus leaving the fan altogether puts the lift back on number one.
        if (!e.currentTarget.contains(e.relatedTarget)) setActive(0);
      }}
    >
      <div aria-hidden className="st-fan-ground" />
      <ol className="st-fan-list">
        {rows.map((row, i) => (
          <Sleeve
            key={row.id}
            row={row}
            index={i}
            cover={covers[row.coverId]}
            active={i === active}
            onActive={() => setActive(i)}
          />
        ))}
      </ol>
      <div aria-hidden className="st-fan-plank" />
    </section>
  );
}

function Sleeve({
  row,
  index,
  cover,
  active,
  onActive,
}: {
  row: Row;
  index: number;
  cover: string | undefined;
  active: boolean;
  onActive: () => void;
}) {
  const offset = SLOT_OF_RANK[index] - MIDDLE_SLOT;
  const style = {
    // --a tilts the sleeve, --k orders the fan-out from the middle outwards.
    "--a": `${offset * DEGREES_PER_STEP}deg`,
    "--k": Math.abs(offset),
    zIndex: active ? 10 : 5 - Math.abs(offset),
  } as CSSProperties;
  const medal = medalFor(row.rank);
  return (
    <li
      className="st-fan-sleeve"
      data-active={active}
      data-shape={row.round ? "disc" : "sleeve"}
      data-side={offset < 0 ? "left" : "right"}
      style={style}
    >
      <button
        type="button"
        onPointerEnter={onActive}
        onFocus={onActive}
        aria-label={`${row.rank}. ${row.title}, ${row.subtitle}, ${playsLabel(row.plays)}`}
        className="st-fan-hit"
      >
        {!row.round && (
          <span aria-hidden className="st-fan-record">
            <span className="st-fan-record-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI */}
        <img src={cover} alt="" draggable={false} data-medal={medal} className="st-fan-art" />
        <span aria-hidden className="st-fan-rank" data-medal={medal}>
          {row.rank}
        </span>
        <span aria-hidden className="st-fan-tag">
          <span className="line-clamp-2 text-[15px] font-semibold leading-tight text-white">{row.title}</span>
          <span className="block text-[13px] tabular-nums text-white/75">{playsLabel(row.plays)}</span>
        </span>
      </button>
    </li>
  );
}
