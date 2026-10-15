"use client";

import type { CSSProperties } from "react";
import { LibraryIcon, SettingsIcon } from "../../Icons";
import { Choice, EditWidgets, ImportButton, NavItem, PanelControls, focusRing } from "./controls";
import { MenuIcon } from "./icons";
import MockLibrary from "./MockLibrary";
import { PERIODS } from "./sample-data";
import StatList from "./StatList";
import { useFloatingPanel, usePanelRefs, type PanelStart } from "./use-floating-panel";
import { useStats } from "./use-stats";

const rule =
  "h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgb(255_255_255/0.14)_18%,rgb(255_255_255/0.14)_82%,transparent)]";

const step = (d: number) => ({ "--d": d }) as CSSProperties;

/**
 * Variant 1, "Floating panel" (#154). At rest: a glass three-lines button with the Import pill
 * beside it, top left. Hovering or focusing the button opens a 300px glass panel inset 12px from
 * the top, left and bottom; the button and the pill stay where they are and become the panel's
 * header row. Pinned, the panel stays and the content area shifts right to make room.
 */
export default function Variant1({ start }: { start: PanelStart }) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(start, refs);
  const { period, setPeriod, enabled, toggle } = useStats();
  const heading = PERIODS.find((p) => p.value === period)?.heading ?? "Your week";
  const state = panel.shown ? "open" : "closed";

  return (
    <>
      <div className="sb1-stage absolute inset-0 overflow-y-auto overflow-x-hidden" data-pinned={panel.pinned}>
        <div className="sb1-stage-inner px-6 pb-16 pt-[88px] md:px-10 lg:px-16" data-shift={panel.shift ?? undefined}>
          <MockLibrary />
        </div>
      </div>

      <div ref={rootRef} className="sb1 absolute inset-y-0 left-0 z-30 w-0" {...panel.rootProps}>
        <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
          <button
            ref={triggerRef}
            type="button"
            aria-label="Sidebar menu"
            {...panel.zoneProps}
            {...panel.triggerProps}
            className={`glass-fake relative isolate flex h-10 w-10 items-center justify-center rounded-full text-text transition-[filter] hover:brightness-125 active:scale-95 ${focusRing}`}
          >
            <MenuIcon className="h-[18px] w-[18px]" />
          </button>
          <ImportButton />
        </div>

        <aside
          ref={panelRef}
          id={panel.panelId}
          aria-label="Sidebar"
          tabIndex={-1}
          data-state={state}
          data-pinned={panel.pinned}
          className="sb1-panel z-10 flex flex-col outline-none"
        >
          <div className="sb1-item absolute right-[18px] top-[18px] flex items-center gap-2 text-xs text-text-muted" style={step(0)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
            <img src="/brand/listener-line.svg" alt="" className="h-5 w-5" />
            On this Mac
          </div>

          <nav aria-label="Main" className="sb1-item flex gap-1" style={step(0)}>
            <NavItem icon={LibraryIcon} active className="flex-1">
              Library
            </NavItem>
            <NavItem icon={SettingsIcon} className="flex-1">
              Settings
            </NavItem>
          </nav>

          <div className={`${rule} my-3`} />

          <div className="sb1-item flex items-center justify-between pl-1.5" style={step(1)}>
            <h2 className="text-sm font-bold tracking-[-0.01em] text-text">{heading}</h2>
            <EditWidgets ns="sb1" enabled={enabled} onToggle={toggle} />
          </div>
          <Choice
            ns="sb1"
            kind="seg"
            label="Time period"
            value={period}
            options={PERIODS}
            onChange={setPeriod}
            className="sb1-item mt-2.5 shrink-0"
          />

          <div className="sb1-scroll mt-3 min-h-0 flex-1 overflow-y-auto">
            <StatList ns="sb1" period={period} enabled={enabled} variant="rows" />
          </div>

          <div className={`${rule} mt-1`} />
          <div className="sb1-item pt-2.5" style={step(3)}>
            <PanelControls
              ns="sb1"
              pinned={panel.pinned}
              onPinChange={panel.pin}
              hoverReveal={panel.hoverReveal}
              onHoverRevealChange={panel.setHoverReveal}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
