"use client";

import type { ComponentType, CSSProperties, SVGProps } from "react";
import type { Release } from "../../shared/types";
import type { AmbientPalette } from "../../lib/artwork-palette";
import { IS_DEMO } from "../../lib/demo";
import { PERIODS, periodEmptyLine, periodHeading, releaseCountLabel } from "../../lib/play-stats";
import { ChevronRightIcon, LibraryIcon, PlusIcon, SettingsIcon } from "../Icons";
import { Choice, EditWidgets, NavItem, PanelControls, focusRing } from "./controls";
import { HAS_STATS_PAGE } from "./flags";
import { MenuIcon, PersonIcon, StatsIcon } from "./icons";
import StatList from "./StatList";
import StatShelf from "./StatShelf";
import { useFloatingPanel, usePanelRefs } from "./use-floating-panel";
import { usePeriod, useStats, useWidgets } from "./use-stats";

const rule =
  "h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgb(255_255_255/0.14)_18%,rgb(255_255_255/0.14)_82%,transparent)]";

const step = (d: number) => ({ "--d": d }) as CSSProperties;

// Drawn at 40 to stay level with the panel's rows; the transparent ring around it makes the target 44 (rule 11).
const hitStrip = "relative before:absolute before:-inset-0.5 before:content-['']";
const railButton = `${hitStrip} flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${focusRing}`;

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
      data-page={page}
      onClick={onSelect}
      className={`${railButton} ${className} ${
        active ? "bg-white/[0.1] text-text" : "text-text-muted hover:bg-white/[0.07] hover:text-text"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

/** What the profile shows: the email's first letter when signed in with an email, else a person
 * glyph. Exported for the tests. */
export function profileInitial(signedIn: boolean, email: string | null): string | null {
  if (IS_DEMO || !signedIn) return null;
  const first = email?.trim().charAt(0);
  return first ? first.toUpperCase() : null;
}

/** The profile row's label in the panel, and the rail button's name after "Account: ". */
export function profileLabel(signedIn: boolean, email: string | null): string {
  if (IS_DEMO) return "Read-only sample";
  if (!signedIn) return "On this Mac";
  return email ? email : "Syncing with your phone";
}

/** The profile circle, shared by the rail (32px) and the panel row (28px). */
function ProfileCircle({
  signedIn,
  email,
  className,
}: {
  signedIn: boolean;
  email: string | null;
  className: string;
}) {
  const initial = profileInitial(signedIn, email);
  return (
    <span
      aria-hidden
      data-profile-circle={initial ? "initial" : "glyph"}
      className={`flex shrink-0 items-center justify-center rounded-full ${className} ${
        initial
          ? "bg-[color-mix(in_srgb,var(--accent)_45%,#16161a)] font-semibold text-white ring-1 ring-white/15"
          : "bg-white/[0.07] text-text-muted"
      }`}
    >
      {initial ?? <PersonIcon className="h-4 w-4" />}
    </span>
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
  /** Opens Settings at its account and sync section. Falls back to plain Settings when not given. */
  onProfileClick?: () => void;
  /** Goes to the Stats page. Only used once HAS_STATS_PAGE is on. */
  onStatsClick?: () => void;
  signedIn: boolean;
  email: string | null;
  /** The cover colours the panel's glass tints itself from; neutral when null. */
  palette: AmbientPalette | null;
}

/**
 * The sidebar (#154): a slim 64px rail is always there with the menu button at the top, then
 * Library, Import, a divider and Stats (once its page exists); at the foot sit Settings and, at
 * the very bottom, the profile. With Open on hover on, hovering the rail blooms a wider glass panel out of
 * its right edge, and it hides again after the pointer leaves; a click on the menu button opens it
 * (in either mode) and it then stays until the menu button is clicked again, Escape, or a page is
 * chosen. Choosing a page, on the rail or in the panel, goes straight there and closes an unpinned
 * panel. The panel names each rail icon on a row beside it and holds the play widgets. Pinned, the
 * panel docks as a column beside the rail and the pane shifts over.
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
  onProfileClick,
  onStatsClick,
  signedIn,
  email,
  palette,
}: SidebarProps) {
  const refs = usePanelRefs();
  const { root: rootRef, trigger: triggerRef, panel: panelRef } = refs;
  const panel = useFloatingPanel(refs);
  const { widgets, toggle } = useWidgets();
  const { period, choose: choosePeriod } = usePeriod();
  const stats = useStats(period, releases, panel.shown);
  /** A page handler that also closes an unpinned panel and keeps focus on the page's rail icon. */
  const choose = (page: SidebarPage | "profile", go: () => void) => () => {
    panel.pageChosen(page);
    go();
  };
  const toLibrary = choose("library", onLibraryClick);
  const toImport = choose("import", onImportClick);
  const toSettings = choose("settings", onSettingsClick);
  const toProfile = choose("profile", onProfileClick ?? onSettingsClick);
  const goToStats = HAS_STATS_PAGE && onStatsClick ? choose("stats", onStatsClick) : undefined;
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
        className="sb-rail absolute inset-y-0 left-0 z-20 flex w-16 flex-col items-center py-5"
      >
        {/* The reveal zone: only this top group opens the panel on hover or focus, not Settings, the
            profile or the empty rail between (#264). rootProps on the outer div still keep an open
            panel while the pointer is anywhere in the sidebar. */}
        <div className="flex w-full flex-col items-center" data-reveal-zone {...panel.zoneProps}>
          <button
            ref={triggerRef}
            type="button"
            {...panel.triggerProps}
            className={`${railButton} hover:bg-white/[0.07] hover:text-text ${
              panel.shown ? "text-text" : "text-text-muted"
            }`}
          >
            <MenuIcon className="h-[18px] w-[18px]" />
          </button>
          <RailPageButton page="library" active={activePage === "library"} onSelect={toLibrary} className="mt-2" />
          <button
            type="button"
            aria-label="Import"
            data-page="import"
            onClick={toImport}
            disabled={IS_DEMO}
            title={IS_DEMO ? "Not available in the demo" : undefined}
            aria-current={activePage === "import" ? "page" : undefined}
            className={`${IS_DEMO ? "" : "import-pill "}${hitStrip} mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent hover:bg-accent-hover ${focusRing} ${
              activePage === "import" ? "ring-2 ring-white/25" : ""
            } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent`}
          >
            <PlusIcon className="import-plus h-5 w-5" />
          </button>
          <div className="my-3 h-px w-6 bg-white/[0.14]" />
          {goToStats && (
            <RailPageButton page="stats" active={activePage === "stats"} onSelect={goToStats} />
          )}
        </div>
        {/* The foot: Settings, then the profile at the very bottom. Both rows are h-10 with a gap-2
            between them, the same as the panel's footer, so each sits level with its row. */}
        <div className="mt-auto flex flex-col items-center gap-2">
          <RailPageButton page="settings" active={activePage === "settings"} onSelect={toSettings} />
          <button
            type="button"
            aria-label={`Account: ${profileLabel(signedIn, email)}`}
            data-page="profile"
            onClick={toProfile}
            className={`${railButton} text-text-muted hover:bg-white/[0.07] hover:text-text`}
          >
            <ProfileCircle signedIn={signedIn} email={email} className="h-8 w-8 text-sm" />
          </button>
        </div>
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
        {/* Level with the menu button at the top of the rail. */}
        <div className="sb-item sb-brand h-7" style={step(0)}>
          <PanelControls
            pinned={panel.pinned}
            onPinChange={panel.pin}
            hoverReveal={panel.hoverReveal}
            onHoverRevealChange={panel.setHoverReveal}
          />
        </div>

        {/* Rows line up with the rail icons beside them: Library and Import, then Stats under
            the same divider. */}
        <nav aria-label="Pages" className="sb-item flex flex-col gap-2" style={step(0)}>
          <NavItem
            active={activePage === "library"}
            onClick={toLibrary}
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
            onClick={toImport}
            disabled={IS_DEMO}
            title={IS_DEMO ? "Not available in the demo" : undefined}
          >
            Import
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
          {/* Remounted when the panel hides, so an open popover never outlives the panel (it would
              stay clickable, invisibly, over the library) and the panel never reopens with it open. */}
          <EditWidgets key={state} enabled={widgets} onToggle={toggle} />
        </div>
        <Choice
          kind="seg"
          label="Time period"
          value={period}
          options={PERIODS}
          onChange={choosePeriod}
          className="sb-item mt-1 shrink-0"
        />

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
          {stats.status === "quiet" && (
            <p className="sb-item px-3 py-1 text-[13px] leading-snug text-text-dim" style={step(2)}>
              {periodEmptyLine(period)}
            </p>
          )}
          {stats.status === "empty" && !loading && (
            <p className="sb-item px-3 py-1 text-[13px] leading-snug text-text-dim" style={step(2)}>
              Plays show up here once Locally has counted some. Turn it on in{" "}
              <button
                type="button"
                onClick={toSettings}
                className={`rounded-lg font-medium text-text-muted underline underline-offset-2 transition-colors hover:text-text ${focusRing}`}
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

        {/* The foot, level with the rail's: two h-10 rows with a gap-2 between them, the card's
            bottom padding putting the last row's bottom 20px from the window's bottom. */}
        <div className={rule} />
        <div className="sb-item mt-2 flex flex-col gap-2" style={step(3)}>
          <NavItem active={activePage === "settings"} onClick={toSettings}>
            {PAGES.settings.label}
          </NavItem>
          <NavItem
            onClick={toProfile}
            start={<ProfileCircle signedIn={signedIn} email={email} className="h-7 w-7 text-xs" />}
          >
            {IS_DEMO ? (
              <span className="flex items-center gap-2">
                <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-semibold text-text-soft">
                  Demo
                </span>
                <span className="truncate">{profileLabel(signedIn, email)}</span>
              </span>
            ) : (
              <span className="block truncate">{profileLabel(signedIn, email)}</span>
            )}
          </NavItem>
        </div>
      </aside>
    </div>
  );
}
