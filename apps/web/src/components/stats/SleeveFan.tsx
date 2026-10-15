"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FAN_MAX, fanLayout, type FanSlot } from "../../lib/fan-layout";
import { medalFor, type StatItem } from "../../lib/play-stats";
import { playsLabel } from "../../lib/plays-copy";
import { MusicNoteIcon } from "../Icons";
import { statCoverUrl } from "../sidebar/StatCover";

/**
 * The top ranks as overlapping record sleeves in a fan, number one in the middle with silver and
 * bronze either side (four and five on the outside), a gold, silver and bronze rim on the first
 * three, and the active sleeve (hovered, focused, else number one) lifting and sliding its record
 * out of the top to show its title and plays. Artists are round discs with no record. One component
 * for the sidebar's Stats shelf (`size="shelf"`, three sleeves) and the Stats page (`size="page"`,
 * five); the CSS is `.fan*` in globals.css and the look of each size is set there (#145).
 *
 * With fewer sleeves than the size holds, the layout re-balances (lib/fan-layout).
 *
 * A sleeve is a real control. With `onOpen`, a click, Enter or Space opens it. A mouse only lifts
 * on hover. On touch the first tap lifts a sleeve and the second opens it; a tap anywhere else puts
 * the lift back. Without `onOpen` (the sidebar) a sleeve only lifts.
 */
export default function SleeveFan({
  items,
  size,
  label,
  disc = false,
  onOpen,
}: {
  /** In rank order. */
  items: StatItem[];
  size: "shelf" | "page";
  /** Names the list for screen readers: "Top tracks, most played first". */
  label: string;
  /** Round discs with no record: the artists. */
  disc?: boolean;
  onOpen?: (item: StatItem) => void;
}) {
  const [active, setActive] = useState(0);
  /** The sleeve a touch tap has lifted and the next tap will open. */
  const [armed, setArmed] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** How the latest press arrived: a touch tap and a mouse click are told apart by this. */
  const lastPointer = useRef("mouse");
  const shown = items.slice(0, FAN_MAX);
  const slots = fanLayout(shown.length);
  // A period with fewer sleeves than the one before falls back to number one.
  const current = active < shown.length ? active : 0;

  // A tap anywhere but a sleeve drops a touch lift.
  useEffect(() => {
    if (armed === null) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".fan-hit") && root.current?.contains(e.target)) return;
      setArmed(null);
      setActive(0);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [armed]);

  const reset = () => {
    setActive(0);
    setArmed(null);
  };

  return (
    <div
      ref={root}
      className="fan"
      data-size={size}
      onPointerLeave={(e) => {
        // A finger leaves the moment it lifts; that must not drop the lift a tap just made.
        if (e.pointerType !== "touch") reset();
      }}
      onBlur={(e) => {
        // Focus leaving the fan altogether puts the lift back on number one.
        if (!e.currentTarget.contains(e.relatedTarget)) reset();
      }}
    >
      <div aria-hidden className="fan-ground" />
      <ol aria-label={label} className="fan-list">
        {shown.map((item, i) => (
          <Sleeve
            key={item.id}
            item={item}
            slot={slots[i]}
            disc={disc}
            active={i === current}
            onPointerDown={(type) => {
              lastPointer.current = type;
            }}
            onHover={() => setActive(i)}
            onActivate={(detail) => {
              const touched = lastPointer.current === "touch" && detail !== 0;
              if (touched && armed !== i) {
                setActive(i);
                setArmed(i);
                return;
              }
              setArmed(null);
              onOpen?.(item);
            }}
          />
        ))}
      </ol>
      <div aria-hidden className="fan-plank" />
    </div>
  );
}

function Sleeve({
  item,
  slot,
  disc,
  active,
  onPointerDown,
  onHover,
  onActivate,
}: {
  item: StatItem;
  slot: FanSlot;
  disc: boolean;
  active: boolean;
  onPointerDown: (pointerType: string) => void;
  onHover: () => void;
  /** `detail` is the click's: 0 for a key press, 1 or more for a pointer. */
  onActivate: (detail: number) => void;
}) {
  const cover = statCoverUrl(item.cover);
  const medal = medalFor(item.rank);
  const style = {
    // --a tilts the sleeve, --k orders the fan-out from the middle outwards.
    "--a": `${slot.angle}deg`,
    "--k": Math.abs(slot.offset),
    zIndex: active ? 100 : slot.layer,
  } as CSSProperties;
  return (
    <li
      className="fan-sleeve"
      data-active={active}
      data-shape={disc ? "disc" : "sleeve"}
      data-side={slot.offset < 0 ? "left" : "right"}
      style={style}
    >
      <button
        type="button"
        onPointerDown={(e) => onPointerDown(e.pointerType)}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") onHover();
        }}
        onFocus={onHover}
        onClick={(e) => onActivate(e.detail)}
        aria-label={`${item.rank}. ${item.title}, ${item.subtitle}, ${playsLabel(item.plays)}`}
        className="fan-hit"
      >
        {!disc && (
          <span aria-hidden className="fan-record">
            <span className="fan-record-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
          </span>
        )}
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- local cover route, no optimisation needed
          <img src={cover} alt="" draggable={false} data-medal={medal} className="fan-art" />
        ) : (
          <span data-medal={medal} className="fan-art text-text-muted">
            <MusicNoteIcon className="h-6 w-6" />
          </span>
        )}
        <span aria-hidden className="fan-rank" data-medal={medal}>
          {item.rank}
        </span>
        <span aria-hidden className="fan-tag">
          <span className="fan-tag-title line-clamp-2">{item.title}</span>
          <span className="fan-tag-plays">{playsLabel(item.plays)}</span>
        </span>
      </button>
    </li>
  );
}
