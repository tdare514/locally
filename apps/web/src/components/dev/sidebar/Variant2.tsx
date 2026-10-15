"use client";

import type { CSSProperties } from "react";
import { LibraryIcon, PlusIcon, SettingsIcon } from "../../Icons";
import { Choice, EditWidgets, PanelControls, focusRing } from "./controls";
import { StatsIcon } from "./icons";
import MockLibrary from "./MockLibrary";
import { PERIODS, SAMPLE_RELEASES } from "./sample-data";
import StatList from "./StatList";
import { useFloatingPanel, usePanelRefs, type PanelStart } from "./use-floating-panel";
import { useStats } from "./use-stats";

const rule =
  "h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgb(255_255_255/0.14)_18%,rgb(255_255_255/0.14)_82%,transparent)]";

const step = (d: number) => ({ "--d": d }) as CSSProperties;

const railButton = `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${focusRing}`;

/**
 * Variant 2, "Rail + bloom" (#154). A slim 64px rail is always there: Library, Import, Settings
 * and a stats button. Hovering the rail blooms a wider glass card out of its right edge; the card
 * names each rail icon on the same row and holds the widgets. Pinned, the card docks as a column
 * beside the rail and the content area shifts over.
 */
export default function Variant2({ start }: { start: PanelStart }) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(start, refs);
  const { period, setPeriod, enabled, toggle } = useStats();
  const heading = PERIODS.find((p) => p.value === period)?.heading ?? "Your week";
  const state = panel.shown ? "open" : "closed";

  return (
    <>
      <div className="sb2-stage absolute inset-0 overflow-y-auto overflow-x-hidden" data-pinned={panel.pinned}>
        <div className="sb2-stage-inner px-6 pb-16 pt-14 md:px-10 lg:px-16" data-shift={panel.shift ?? undefined}>
          <MockLibrary />
        </div>
      </div>

      <div ref={rootRef} className="sb2 absolute inset-y-0 left-0 z-30 w-0" {...panel.rootProps}>
        <nav
          aria-label="Main"
          className="sb2-rail absolute inset-y-0 left-0 z-20 flex w-16 flex-col items-center pt-5"
          {...panel.zoneProps}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
          <img src="/brand/listener-line.svg" alt="" className="mb-4 h-7 w-7" />
          <button type="button" aria-label="Library" aria-current="page" className={`${railButton} bg-white/[0.1] text-text`}>
            <LibraryIcon className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Import"
            className={`import-pill mt-2 h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent hover:bg-accent-hover ${focusRing} flex`}
          >
            <PlusIcon className="import-plus h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Settings"
            className={`${railButton} mt-2 text-text-muted hover:bg-white/[0.07] hover:text-text`}
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
          </button>
          <div className="my-3 h-px w-6 bg-white/[0.14]" />
          <button
            ref={triggerRef}
            type="button"
            aria-label="Stream stats"
            {...panel.triggerProps}
            className={`${railButton} ${
              panel.shown ? "bg-white/[0.1] text-text" : "text-text-muted hover:bg-white/[0.07] hover:text-text"
            }`}
          >
            <StatsIcon className="h-[18px] w-[18px]" />
          </button>
        </nav>

        <aside
          ref={panelRef}
          id={panel.panelId}
          aria-label="Stats and sidebar options"
          tabIndex={-1}
          data-state={state}
          data-pinned={panel.pinned}
          className="sb2-card z-10 flex flex-col outline-none"
        >
          {/* The labels line up with the rail icons beside them. The rail buttons stay the real
              controls, so these are text only. */}
          <div aria-hidden className="sb2-item sb2-brand flex h-7 items-center gap-2 text-xs text-text-muted" style={step(0)}>
            <span className="text-sm font-semibold text-text">Locally</span>
            On this Mac
          </div>
          <div aria-hidden className="sb2-item pointer-events-none flex flex-col gap-2" style={step(0)}>
            <div className="flex h-10 items-center justify-between rounded-xl bg-white/[0.07] px-3 text-sm font-medium text-text">
              Library
              <span className="text-xs font-normal text-text-dim">{SAMPLE_RELEASES.length} releases</span>
            </div>
            <div className="flex h-10 items-center px-3 text-sm font-medium text-text-muted">Import</div>
            <div className="flex h-10 items-center px-3 text-sm font-medium text-text-muted">Settings</div>
          </div>

          <div className="sb2-item mt-[25px] flex h-10 shrink-0 items-center justify-between pl-3" style={step(1)}>
            <h2 className="text-sm font-bold tracking-[-0.01em] text-text">{heading}</h2>
            <EditWidgets ns="sb2" enabled={enabled} onToggle={toggle} />
          </div>
          <Choice
            ns="sb2"
            kind="seg"
            label="Time period"
            value={period}
            options={PERIODS}
            onChange={setPeriod}
            className="sb2-item mt-1 shrink-0"
          />

          <div className="sb2-scroll mt-3 min-h-0 flex-1 overflow-y-auto">
            <StatList ns="sb2" period={period} enabled={enabled} variant="lead" />
          </div>

          <div className={`${rule} mt-1`} />
          <div className="sb2-item pt-2.5" style={step(3)}>
            <PanelControls
              ns="sb2"
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
