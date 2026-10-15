"use client";

import { useState, type CSSProperties } from "react";
import { LibraryIcon, SettingsIcon } from "../../Icons";
import { Choice, EditWidgets, ImportButton, NavItem, PanelControls, focusRing } from "./controls";
import { MenuIcon, StatsIcon } from "./icons";
import MockLibrary from "./MockLibrary";
import { medalFor, PERIODS, topFor, WIDGETS, type Period, type StatItem, type WidgetKey } from "./sample-data";
import { useFloatingPanel, usePanelRefs, type PanelStart } from "./use-floating-panel";
import { useCovers, useStats } from "./use-stats";

/** The two buttons that open the card read as switched on while it shows. */
const litChip = "bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-text";

const pillButton = `flex shrink-0 items-center gap-2 rounded-full text-sm font-medium transition-colors ${focusRing}`;

/**
 * Variant 3, "Stats shelf" (#154). The nav is a floating glass pill, top left: three lines,
 * Library, Settings, a Stats chip and Import. Hovering the three lines or the Stats chip drops a
 * card under the pill where the top five lie as overlapping record sleeves that fan out. The
 * lifted sleeve shows its title and plays (number one until another is hovered); the first three
 * get a gold, silver and bronze rim. Tracks, Albums and Artists tabs switch the shelf. Pinned, the
 * card stays open.
 */
export default function Variant3({ start }: { start: PanelStart }) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(start, refs);
  const { period, setPeriod, enabled, toggle } = useStats();
  const [tab, setTab] = useState<WidgetKey>("tracks");
  const state = panel.shown ? "open" : "closed";

  const tabs = WIDGETS.filter((w) => enabled[w.key]);
  const current = tabs.find((w) => w.key === tab)?.key ?? tabs[0]?.key;

  return (
    <>
      <div className="sb3-stage absolute inset-0 overflow-y-auto overflow-x-hidden">
        <div className="px-6 pb-16 pt-[100px] md:px-10 lg:px-16">
          <MockLibrary />
        </div>
      </div>

      <div ref={rootRef} className="sb3 absolute inset-y-0 left-0 z-30 w-0" {...panel.rootProps}>
        <nav
          aria-label="Main"
          className="sb3-pill glass-fake absolute left-5 top-5 z-20 isolate flex h-12 items-center gap-1 rounded-full p-1.5"
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label="Stats and sidebar options"
            {...panel.zoneProps}
            {...panel.triggerProps}
            className={`${pillButton} h-9 w-9 justify-center text-text active:scale-95 ${
              panel.shown ? litChip : "hover:bg-white/[0.1]"
            }`}
          >
            <MenuIcon className="h-[18px] w-[18px]" />
          </button>
          <NavItem icon={LibraryIcon} active className="h-9 rounded-full py-0 pl-3 pr-3.5">
            Library
          </NavItem>
          <NavItem icon={SettingsIcon} className="h-9 rounded-full py-0 pl-3 pr-3.5">
            Settings
          </NavItem>
          <button
            type="button"
            {...panel.zoneProps}
            {...panel.triggerProps}
            className={`${pillButton} h-9 px-3.5 ${
              panel.shown ? litChip : "text-text-muted hover:bg-white/[0.08] hover:text-text"
            }`}
          >
            <StatsIcon className="h-4 w-4" />
            Stats
          </button>
          <ImportButton compact />
        </nav>

        <div
          ref={panelRef}
          id={panel.panelId}
          role="region"
          aria-label="Stream stats"
          tabIndex={-1}
          data-state={state}
          className="sb3-card z-10 flex flex-col outline-none"
        >
          <div className="sb3-item flex items-center justify-between gap-3" style={{ "--d": 0 } as CSSProperties}>
            {tabs.length > 0 ? (
              <Choice
                ns="sb3"
                kind="tabs"
                label="Show top"
                value={current ?? "tracks"}
                options={tabs.map((w) => ({ value: w.key, label: w.tab }))}
                onChange={setTab}
              />
            ) : (
              <span />
            )}
            <Choice ns="sb3" kind="seg" label="Time period" value={period} options={PERIODS} onChange={setPeriod} className="w-[252px]" />
          </div>

          {current ? (
            <Shelf kind={current} period={period} />
          ) : (
            <p className="py-16 text-center text-sm text-text-muted">No widgets on. Use Edit widgets to add one.</p>
          )}

          <div className="sb3-item flex items-center justify-between gap-2" style={{ "--d": 3 } as CSSProperties}>
            <EditWidgets ns="sb3" enabled={enabled} onToggle={toggle} placement="above" />
            <PanelControls
              ns="sb3"
              pinned={panel.pinned}
              onPinChange={panel.pin}
              hoverReveal={panel.hoverReveal}
              onHoverRevealChange={panel.setHoverReveal}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** Where each rank sits across the fan, left to right: number one in the middle with silver on its
 * left and bronze on its right, like a podium. The DOM stays in rank order for the keyboard. */
const SLOT_OF_RANK = [2, 1, 3, 0, 4];

/** Five sleeves that overlap and fan out. The active one (hovered, focused, else number one) lifts
 * and shows its title and plays; its record slides out of the top. */
function Shelf({ kind, period }: { kind: WidgetKey; period: Period }) {
  const covers = useCovers();
  const items = topFor(kind, period);
  const [active, setActive] = useState(0);
  const title = WIDGETS.find((w) => w.key === kind)?.title ?? "";

  return (
    <div className="sb3-shelf" onPointerLeave={() => setActive(0)}>
      <div aria-hidden className="sb3-ground" />
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
      <div aria-hidden className="sb3-plank" />
    </div>
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
  const offset = SLOT_OF_RANK[index] - 2;
  const style = {
    // --a tilts the sleeve, --k orders the fan-out from the middle outwards.
    "--a": `${offset * 12}deg`,
    "--k": Math.abs(offset),
    zIndex: active ? 10 : 5 - Math.abs(offset),
  } as CSSProperties;
  return (
    <li
      className="sb3-sleeve"
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
        className={`sb3-hit rounded-lg ${focusRing}`}
      >
        {!disc && (
          <span aria-hidden className="sb3-record">
            <span className="sb3-record-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
          </span>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI */}
        <img src={cover} alt="" data-medal={medalFor(item.rank)} className="sb3-art" />
        <span aria-hidden className="sb3-rank" data-medal={medalFor(item.rank)}>
          {item.rank}
        </span>
        <span aria-hidden className="sb3-tag">
          <span className="line-clamp-2 text-xs font-semibold leading-tight text-white">{item.title}</span>
          <span className="block text-[11px] tabular-nums text-white/75">{item.plays} plays</span>
        </span>
      </button>
    </li>
  );
}
