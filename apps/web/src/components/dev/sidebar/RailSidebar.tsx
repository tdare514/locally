"use client";

import { useState, type ComponentType, type CSSProperties, type SVGProps } from "react";
import { ChevronRightIcon, LibraryIcon, PlusIcon, SettingsIcon } from "../../Icons";
import { Choice, EditWidgets, NavItem, PanelControls, focusRing } from "./controls";
import { MenuIcon, StatsIcon } from "./icons";
import MockLibrary, { PlaceholderPage } from "./MockLibrary";
import { PERIODS, SAMPLE_RELEASES } from "./sample-data";
import StatList from "./StatList";
import StatShelf from "./StatShelf";
import { useFloatingPanel, usePanelRefs, type PanelStart } from "./use-floating-panel";
import { useStats } from "./use-stats";

const rule =
  "h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgb(255_255_255/0.14)_18%,rgb(255_255_255/0.14)_82%,transparent)]";

const step = (d: number) => ({ "--d": d }) as CSSProperties;

const railButton = `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${focusRing}`;

type Page = "library" | "settings" | "stats";

const PAGES: Record<Page, { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = {
  library: { label: "Library", Icon: LibraryIcon },
  settings: { label: "Settings", Icon: SettingsIcon },
  stats: { label: "Stats", Icon: StatsIcon },
};

/** A page icon on the rail. A click always goes to the page, whether or not the card is open. */
function RailPageButton({
  page,
  active,
  onSelect,
  className = "",
}: {
  page: Page;
  active: boolean;
  onSelect: (page: Page) => void;
  className?: string;
}) {
  const { label, Icon } = PAGES[page];
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(page)}
      className={`${railButton} ${className} ${
        active ? "bg-white/[0.1] text-text" : "text-text-muted hover:bg-white/[0.07] hover:text-text"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/**
 * The #154 sidebar: "Rail + bloom". A slim 64px rail is always there: Library, Import, Settings and
 * Stats, and the menu button under them. With "Open on hover" on, hovering the rail blooms a wider
 * glass card out of its right edge; with it off only the menu button opens the card. Either way a
 * click on Library, Settings or Stats goes straight to that page. The card names each rail icon on
 * a row beside it (Library, Import, Settings, then Stats) and holds the widgets. Pinned, the card
 * docks as a column beside the rail and the content area shifts over.
 */
export default function RailSidebar({
  start,
  hoverReveal,
  onHoverRevealChange,
}: {
  start: PanelStart;
  hoverReveal: boolean;
  onHoverRevealChange: (next: boolean) => void;
}) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(start, refs, hoverReveal);
  const { period, setPeriod, enabled, toggle } = useStats();
  const [page, setPage] = useState<Page>("library");
  const heading = PERIODS.find((p) => p.value === period)?.heading ?? "Your week";
  const state = panel.shown ? "open" : "closed";

  const pageRow = (p: Page) => (
    <NavItem
      icon={PAGES[p].Icon}
      active={page === p}
      onClick={() => setPage(p)}
      end={
        p === "library" ? (
          <span className="text-xs font-normal text-text-dim">{SAMPLE_RELEASES.length} releases</span>
        ) : undefined
      }
    >
      {PAGES[p].label}
    </NavItem>
  );

  return (
    <>
      <div
        className="sb-stage absolute inset-0 overflow-y-auto overflow-x-hidden"
        data-pinned={panel.pinned}
        data-page={page}
      >
        <div className="sb-stage-inner px-6 pb-16 pt-14 md:px-10 lg:px-16" data-shift={panel.shift ?? undefined}>
          {page === "library" ? (
            <MockLibrary />
          ) : (
            <PlaceholderPage
              title={PAGES[page].label}
              note={
                page === "stats"
                  ? "Placeholder. The real page shows the top five of each list, and the regular stats."
                  : "Placeholder."
              }
            />
          )}
        </div>
      </div>

      <div ref={rootRef} className="sb absolute inset-y-0 left-0 z-30 w-0" {...panel.rootProps}>
        <nav
          aria-label="Main"
          className="sb-rail absolute inset-y-0 left-0 z-20 flex w-16 flex-col items-center pt-5"
          {...panel.zoneProps}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
          <img src="/brand/listener-line.svg" alt="" className="mb-4 h-7 w-7" />
          <RailPageButton page="library" active={page === "library"} onSelect={setPage} />
          <button
            type="button"
            aria-label="Import"
            className={`import-pill mt-2 h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent hover:bg-accent-hover ${focusRing} flex`}
          >
            <PlusIcon className="import-plus h-5 w-5" />
          </button>
          <RailPageButton page="settings" active={page === "settings"} onSelect={setPage} className="mt-2" />
          <div className="my-3 h-px w-6 bg-white/[0.14]" />
          <RailPageButton page="stats" active={page === "stats"} onSelect={setPage} />
          <button
            ref={triggerRef}
            type="button"
            aria-label="Sidebar menu"
            {...panel.triggerProps}
            className={`${railButton} mt-2 hover:bg-white/[0.07] hover:text-text ${
              panel.shown ? "text-text" : "text-text-muted"
            }`}
          >
            <MenuIcon className="h-[18px] w-[18px]" />
          </button>
        </nav>

        <aside
          ref={panelRef}
          id={panel.panelId}
          aria-label="Sidebar"
          tabIndex={-1}
          data-state={state}
          data-pinned={panel.pinned}
          className="sb-card z-10 flex flex-col outline-none"
        >
          <div className="sb-item sb-brand flex h-7 items-center gap-2 text-xs text-text-muted" style={step(0)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
            <img src="/brand/listener-line.svg" alt="" className="h-5 w-5" />
            On this Mac
          </div>

          {/* Rows line up with the rail icons beside them: Library, Import and Settings, then Stats
              under the same divider. */}
          <nav aria-label="Pages" className="sb-item flex flex-col gap-2" style={step(0)}>
            {pageRow("library")}
            <NavItem icon={PlusIcon}>Import</NavItem>
            {pageRow("settings")}
            <div aria-hidden className={`${rule} my-1`} />
            {pageRow("stats")}
          </nav>

          <div className="sb-item mt-2 flex h-10 shrink-0 items-center justify-between pl-3" style={step(1)}>
            <h2 className="text-sm font-bold tracking-[-0.01em] text-text">{heading}</h2>
            <EditWidgets enabled={enabled} onToggle={toggle} />
          </div>
          <Choice
            kind="seg"
            label="Time period"
            value={period}
            options={PERIODS}
            onChange={setPeriod}
            className="sb-item mt-1 shrink-0"
          />

          <div className="sb-scroll mt-3 min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3">
              {enabled.shelf && <StatShelf period={period} />}
              <StatList period={period} enabled={enabled} />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPage("stats")}
            className={`sb-item mb-1 mt-0.5 flex shrink-0 items-center gap-1 self-start rounded-full py-1.5 pl-3 pr-2 text-xs font-semibold text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text ${focusRing}`}
            style={step(3)}
          >
            See all stats
            <ChevronRightIcon className="h-3 w-3" />
          </button>

          <div className={rule} />
          <div className="sb-item pt-2.5" style={step(3)}>
            <PanelControls
              pinned={panel.pinned}
              onPinChange={panel.pin}
              hoverReveal={hoverReveal}
              onHoverRevealChange={onHoverRevealChange}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
