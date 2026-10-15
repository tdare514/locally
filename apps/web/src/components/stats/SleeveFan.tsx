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
 * three, and the active sleeve (hovered, focused, else number one) lifting and its record peeking over
 * the top while its title and plays show. Artists are round discs with no record. One component
 * for the sidebar's Stats shelf (`size="shelf"`, three sleeves) and the Stats page (`size="page"`,
 * five); the CSS is `.fan*` in globals.css and the look of each size is set there (#145).
 *
 * With fewer sleeves than the size holds, the layout re-balances (lib/fan-layout).
 *
 * A sleeve is a real control. With `onOpen`, a click, Enter or Space opens it. A mouse only lifts
 * on hover. On touch the first tap lifts a sleeve and the second opens it; a tap anywhere else puts
 * the lift back. A sleeve plays a short opening beat before it opens. Without `onOpen` (the sidebar) a sleeve only lifts.
 */
/** The opening beat, matching `.fan-sleeve[data-opening]` in globals.css. */
const OPENING_MS = 360;

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
  /** The sleeve playing its opening beat, before the release opens. */
  const [opening, setOpening] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    []
  );

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
        if (e.pointerType === "touch") return;
        // A sleeve with keyboard focus keeps the lift, so what is lifted is what Enter opens.
        const hits = [...(root.current?.querySelectorAll<HTMLElement>(".fan-hit") ?? [])];
        const focused = hits.findIndex((h) => h === document.activeElement);
        if (focused >= 0) setActive(focused);
        else reset();
      }}
      onKeyDown={(e) => {
        // ← → wheel through the sleeves in the order they sit, not by rank. No wrap-around.
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const hits = [...(root.current?.querySelectorAll<HTMLElement>(".fan-hit") ?? [])];
        const at = hits.findIndex((h) => h === document.activeElement);
        if (at < 0) return;
        const visual = hits.map((_, i) => i).sort((a, b) => slots[a].offset - slots[b].offset);
        const next = visual[visual.indexOf(at) + (e.key === "ArrowRight" ? 1 : -1)];
        e.preventDefault();
        if (next !== undefined) hits[next].focus();
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
            opening={i === opening}
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
              if (!onOpen || opening !== null) return;
              if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                onOpen(item);
                return;
              }
              // One short beat (the record slides out, the sleeve lifts), then the release opens.
              setOpening(i);
              openTimer.current = setTimeout(() => {
                openTimer.current = null;
                setOpening(null);
                onOpen(item);
              }, OPENING_MS);
            }}
          />
        ))}
      </ol>
      <div aria-hidden className="fan-plank" />
      {size === "page" && shown[current] && (
        // Where the sleeves are small the tag no longer fits on the cover; this says the same under the fan.
        // Hidden from screen readers: each sleeve's own name already carries the title and plays.
        <p aria-hidden className="fan-caption">
          <span className="fan-caption-title">{shown[current].title}</span>
          <span className="fan-caption-plays">{playsLabel(shown[current].plays)}</span>
        </p>
      )}
    </div>
  );
}

function Sleeve({
  item,
  slot,
  disc,
  active,
  opening,
  onPointerDown,
  onHover,
  onActivate,
}: {
  item: StatItem;
  slot: FanSlot;
  disc: boolean;
  active: boolean;
  opening: boolean;
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
    // --o is the signed step from the middle; the sideways step multiplies it (0 on the page now).
    "--o": slot.offset,
    zIndex: active ? 100 : slot.layer,
  } as CSSProperties;
  return (
    <li
      className="fan-sleeve"
      data-active={active}
      data-opening={opening}
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
        {item.rank <= 5 && !disc && (
          <span aria-hidden className="fan-crown">
            {/* eslint-disable-next-line @next/next/no-img-element -- two tiny local SVGs, swapped by CSS at 64px */}
            <img src={`/crowns/crown-${item.rank}.svg`} alt="" draggable={false} decoding="async" className="fan-crown-full" />
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img src={`/crowns/crown-${item.rank}-small.svg`} alt="" draggable={false} decoding="async" className="fan-crown-small" />
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
