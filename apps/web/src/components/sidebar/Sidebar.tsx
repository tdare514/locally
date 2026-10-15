"use client";

import { useState, type ComponentType, type CSSProperties, type SVGProps } from "react";
import type { Release } from "../../shared/types";
import type { AmbientPalette } from "../../lib/artwork-palette";
import { IS_DEMO } from "../../lib/demo";
import { PERIODS, periodHeading, releaseCountLabel, type StatsPeriod } from "../../lib/play-stats";
import { ChevronRightIcon, LibraryIcon, PlusIcon, SettingsIcon } from "../Icons";
import { Choice, EditWidgets, NavItem, PanelControls, focusRing } from "./controls";
import { HAS_DAILY_COUNTS, HAS_STATS_PAGE } from "./flags";
import { MenuIcon, StatsIcon } from "./icons";
import StatList from "./StatList";
import StatShelf from "./StatShelf";
import { useFloatingPanel, usePanelRefs } from "./use-floating-panel";
import { DEFAULT_PERIOD, useStats, useWidgets } from "./use-stats";

const rule =
  "h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgb(255_255_255/0.14)_18%,rgb(255_255_255/0.14)_82%,transparent)]";

const step = (d: number) => ({ "--d": d }) as CSSProperties;

const railButton = `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${focusRing}`;

/** The pages the rail and the panel go to. Stats waits for its page (see HAS_STATS_PAGE). */
export type SidebarPage = "library" | "import" | "settings" | "stats";

const PAGES: Record<
  "library" | "settings" | "stats",
  { label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  library: { label: "Library", Icon: LibraryIcon },
  settings: { label: "Settings", Icon: SettingsIcon },
  stats: { label: "Stats", Icon: StatsIcon },
};

/** A page icon on the rail. A click always goes to the page, whether or not the panel is open. */
function RailPageButton({
  page,
  active,
  onSelect,
  className = "",
}: {
  page: keyof typeof PAGES;
  active: boolean;
  onSelect: () => void;
  className?: string;
}) {
  const { label, Icon } = PAGES[page];
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={`${railButton} ${className} ${
        active ? "bg-white/[0.1] text-text" : "text-text-muted hover:bg-white/[0.07] hover:text-text"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

interface SidebarProps {
  releases: Release[];
  /** The library is still loading: the Library row has no count yet and no empty line shows. */
  loading: boolean;
  /** The page on screen, or null on a release page. */
  activePage: SidebarPage | null;
  onLibraryClick: () => void;
  onImportClick: () => void;
  onSettingsClick: () => void;
  /** Goes to the Stats page. Only used once HAS_STATS_PAGE is on. */
  onStatsClick?: () => void;
  signedIn: boolean;
  email: string | null;
  /** The cover colours the panel's glass tints itself from; neutral when null. */
  palette: AmbientPalette | null;
}

/**
 * The sidebar (#154): a slim 64px rail is always there with Library, Import, Settings, a divider,
 * Stats (once its page exists) and the menu button. With Open on hover on, hovering the rail
 * blooms a wider glass panel out of its right edge; with it off only the menu button opens the
 * panel. Either way a click on a page goes straight there. The panel names each rail icon on a
 * row beside it and holds the play widgets. Pinned, the panel docks as a column beside the rail
 * and the pane shifts over.
 *
 * The pane is this component's next sibling with the class `sb-stage`: the CSS in globals.css
 * pads it and slides it from the `data-pinned` and `data-shift` on `.sb`.
 */
export default function Sidebar({
  releases,
  loading,
  activePage,
  onLibraryClick,
  onImportClick,
  onSettingsClick,
  onStatsClick,
  signedIn,
  email,
  palette,
}: SidebarProps) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(refs);
  const { widgets, toggle } = useWidgets();
  const [period, setPeriod] = useState<StatsPeriod>(DEFAULT_PERIOD);
  const stats = useStats(period, releases, panel.shown);
  const goToStats = HAS_STATS_PAGE ? onStatsClick : undefined;
  const state = panel.shown ? "open" : "closed";

  const ambient = palette
    ? ({
        "--ambient-primary": palette.primary,
        "--ambient-secondary": palette.secondary,
        "--ambient-deep": palette.deep,
      } as CSSProperties)
    : undefined;

  return (
    <div
      ref={rootRef}
      className="sb absolute inset-y-0 left-0 z-30 w-0"
      data-pinned={panel.pinned}
      data-shift={panel.shift ?? undefined}
      style={ambient}
      {...panel.rootProps}
    >
      <nav
        aria-label="Main"
        className="sb-rail absolute inset-y-0 left-0 z-20 flex w-16 flex-col items-center pt-5"
        {...panel.zoneProps}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
        <img src="/brand/listener-line.svg" alt="" className="mb-4 h-7 w-7" />
        <RailPageButton page="library" active={activePage === "library"} onSelect={onLibraryClick} />
        <button
          type="button"
          aria-label="Import"
          onClick={onImportClick}
          disabled={IS_DEMO}
          title={IS_DEMO ? "Not available in the demo" : undefined}
          aria-current={activePage === "import" ? "page" : undefined}
          className={`${IS_DEMO ? "" : "import-pill "}mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent hover:bg-accent-hover ${focusRing} ${
            activePage === "import" ? "ring-2 ring-white/25" : ""
          } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent`}
        >
          <PlusIcon className="import-plus h-5 w-5" />
        </button>
        <RailPageButton
          page="settings"
          active={activePage === "settings"}
          onSelect={onSettingsClick}
          className="mt-2"
        />
        <div className="my-3 h-px w-6 bg-white/[0.14]" />
        {goToStats && (
          <RailPageButton page="stats" active={activePage === "stats"} onSelect={goToStats} />
        )}
        <button
          ref={triggerRef}
          type="button"
          aria-label="Sidebar menu"
          {...panel.triggerProps}
          className={`${railButton} ${goToStats ? "mt-2" : ""} hover:bg-white/[0.07] hover:text-text ${
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
        {/* No logo here: the rail beside it already carries one. */}
        <div className="sb-item sb-brand flex h-7 items-center gap-2 text-xs text-text-muted" style={step(0)}>
          {IS_DEMO ? (
            <>
              <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-semibold text-text-soft">
                Demo
              </span>
              <span className="truncate">Read-only sample</span>
            </>
          ) : (
            <span className="truncate">
              {signedIn ? (email ? email : "Syncing with your phone") : "On this Mac"}
            </span>
          )}
        </div>

        {/* Rows line up with the rail icons beside them: Library, Import and Settings, then Stats
            under the same divider. */}
        <nav aria-label="Pages" className="sb-item flex flex-col gap-2" style={step(0)}>
          <NavItem
            active={activePage === "library"}
            onClick={onLibraryClick}
            end={
              loading ? undefined : (
                <span className="text-xs font-normal text-text-dim">{releaseCountLabel(releases.length)}</span>
              )
            }
          >
            {PAGES.library.label}
          </NavItem>
          <NavItem
            active={activePage === "import"}
            onClick={onImportClick}
            disabled={IS_DEMO}
            title={IS_DEMO ? "Not available in the demo" : undefined}
          >
            Import
          </NavItem>
          <NavItem active={activePage === "settings"} onClick={onSettingsClick}>
            {PAGES.settings.label}
          </NavItem>
          {goToStats && (
            <>
              <div aria-hidden className={`${rule} my-1`} />
              <NavItem active={activePage === "stats"} onClick={goToStats}>
                {PAGES.stats.label}
              </NavItem>
            </>
          )}
        </nav>

        <div className="sb-item mt-2 flex h-10 shrink-0 items-center justify-between pl-3" style={step(1)}>
          <h2 className="text-sm font-bold tracking-[-0.01em] text-text">{periodHeading(period)}</h2>
          <EditWidgets enabled={widgets} onToggle={toggle} />
        </div>
        {/* Hidden until the Mac stores per-day counts (#193). */}
        {HAS_DAILY_COUNTS && (
          <Choice
            kind="seg"
            label="Time period"
            value={period}
            options={PERIODS}
            onChange={setPeriod}
            className="sb-item mt-1 shrink-0"
          />
        )}

        <div className="sb-scroll mt-3 min-h-0 flex-1 overflow-y-auto" aria-busy={stats.status === "loading"}>
          {stats.status === "ready" && (
            <div className="flex flex-col gap-3">
              {widgets.shelf && <StatShelf stats={stats.stats} />}
              <StatList stats={stats.stats} enabled={widgets} />
            </div>
          )}
          {stats.status === "error" && (
            <p className="sb-item px-3 py-1 text-[13px] leading-snug text-text-dim" style={step(2)}>
              Couldn&apos;t load your plays. It will try again the next time this opens.
            </p>
          )}
          {stats.status === "empty" && !loading && (
            <p className="sb-item px-3 py-1 text-[13px] leading-snug text-text-dim" style={step(2)}>
              Plays show up here once Locally has counted some. Turn it on in{" "}
              <button
                type="button"
                onClick={onSettingsClick}
                className={`rounded font-medium text-text-muted underline underline-offset-2 transition-colors hover:text-text ${focusRing}`}
              >
                Settings
              </button>
              .
            </p>
          )}
        </div>

        {goToStats && (
          <button
            type="button"
            onClick={goToStats}
            className={`sb-item mb-1 mt-0.5 flex shrink-0 items-center gap-1 self-start rounded-full py-1.5 pl-3 pr-2 text-xs font-semibold text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text ${focusRing}`}
            style={step(3)}
          >
            See all stats
            <ChevronRightIcon className="h-3 w-3" />
          </button>
        )}

        <div className={rule} />
        <div className="sb-item pt-2.5" style={step(3)}>
          <PanelControls
            pinned={panel.pinned}
            onPinChange={panel.pin}
            hoverReveal={panel.hoverReveal}
            onHoverRevealChange={panel.setHoverReveal}
          />
        </div>
      </aside>
    </div>
  );
}
