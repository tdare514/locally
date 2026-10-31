"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Library, Release, ReleaseKind, SyncStatus } from "../shared/types";
import { acceptFriendShare, hideFriendShare, acceptFromPhone, getLibrary, getSyncStatus, hideFromTray, resyncFromPhone, unhideFromTray } from "../lib/api-client";
import Sidebar, { type SidebarPage } from "./sidebar/Sidebar";
import LibraryView from "./LibraryView";
import { buildArtistIndex } from "../lib/artist-index";
import { buildArtistCatalog, catalogEntry, creditKey } from "../lib/artist-catalog";
import ArtistView from "./ArtistView";
import { ArtistNavProvider } from "./ArtistNav";
import { IS_DEMO } from "../lib/demo";
import ImportView from "./ImportView";
import ReleaseView from "./ReleaseView";
import SettingsView from "./SettingsView";
import AdoptReviewView from "./AdoptReviewView";
import StatsView, { DEFAULT_STATS_PREFS, type StatsPrefs } from "./stats/StatsView";
import { STATS_PAGE_SIZE } from "../lib/stats-layout";
import type { LibrarySort } from "../lib/library-sections";
import AmbientSpace from "./AmbientSpace";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import PhoneInbox, { type ResyncOutcome } from "./PhoneInbox";
import BackButton from "./BackButton";
import { runScrollRestore } from "../lib/scroll-restore";
import {
  backLabel,
  clearStack,
  popEntry,
  pushEntry,
  stackAfterImport,
  type BackEntry,
  type BackStack,
} from "../lib/back-stack";
import Toast, { type ToastMessage } from "./Toast";
import Player from "./Player";
import CollectionsView from "./CollectionsView";
import { CollectionsProvider } from "./CollectionsContext";

export type View =
  | { type: "library" }
  | { type: "import"; kind?: ReleaseKind }
  | { type: "release"; id: string; justImported?: boolean; trackId?: string }
  | { type: "settings"; section?: "account" }
  | { type: "stats" }
  /** The Collections page (#349); `id` is the collection on show (the first when absent). */
  | { type: "collections"; id?: string }
  /** An artist's page (#288), by `artistKey`. */
  | { type: "artist"; key: string }
  /** The review page for the Spotify folders (#249). `scan`: read the folders first. */
  | { type: "adopt"; scan: boolean };

/** What a back entry restores besides the view: the state AppShell keeps for the pages. */
interface BackState {
  query: string;
  sort: LibrarySort;
  stats: StatsPrefs;
  /** Rows the Stats ranking shows after "Show more". */
  statsShown: number;
}

export default function AppShell() {
  const [view, setView] = useState<View>({ type: "library" });
  const [library, setLibrary] = useState<Library | null>(null);
  // Every artist name the library holds, for the Artist fields' suggestions (#287).
  const artistIndex = useMemo(() => buildArtistIndex(library?.releases ?? []), [library]);
  // One entry per artist for the Artists view and the artist page (#288).
  const artistCatalog = useMemo(() => buildArtistCatalog(library?.releases ?? []), [library]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  // Lives here (not in LibraryView) so the query survives opening a release and coming back.
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("newest");
  // Same for the Stats page's tab, period, layout and sort (#145).
  const [statsPrefs, setStatsPrefs] = useState<StatsPrefs>(DEFAULT_STATS_PREFS);
  // The cover LibraryView wants the ambient space tinted by; the wash lives out here so it
  // sits outside the scrolling pane.
  const [ambientCoverUrl, setAmbientCoverUrl] = useState<string | null>(null);
  const libraryPalette = useArtworkPalette(view.type === "library" ? ambientCoverUrl : null);
  // The views left behind by opening a release or an artist's library (#258). A page chosen from
  // the rail, sidebar panel or profile clears it.
  const [backStack, setBackStack] = useState<BackStack<View, BackState>>(clearStack);
  const pendingScroll = useRef<number | null>(null);
  // Stats says when its ranking has loaded (or failed); every other page is ready at once.
  const contentReady = useRef(true);
  const [statsShown, setStatsShown] = useState(STATS_PAGE_SIZE);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);
  // The library sky follows the scroll through --pane-progress and --pane-swirl on the sky
  // element (which fills the whole window, under the sidebar too), eased each frame so it twists while scrolling and settles after. Written
  // straight to the style, not React state, so scrolling never re-renders the app.
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((kind: "success" | "error", text: string, action?: ToastMessage["action"]) => {
    nextToastId.current += 1;
    const id = nextToastId.current;
    setToasts((prev) => [...prev, { id, kind, text, action }]);
    // A toast with an action stays long enough to be used.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, action ? 8000 : 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Only the first load shows "Loading…": later refreshes (after an import,
  // edit, delete, or bulk action) swap the list in place so the library view
  // keeps its toolbar and selection state on screen.
  const refreshLibrary = useCallback(() => {
    return getLibrary()
      .then((lib) => setLibrary(lib))
      .catch((e) =>
        showToast("error", e instanceof Error ? e.message : "Failed to load library")
      )
      .finally(() => setLoadingLibrary(false));
  }, [showToast]);

  useEffect(() => {
    const main = mainRef.current;
    const shell = shellRef.current;
    if (!main || !shell) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let current = 0;
    let target = 0;
    let swirl = 0;
    let lastTop = main.scrollTop;
    let speed = 0;
    const step = () => {
      current += (target - current) * 0.08;
      // Swirl follows scroll speed and eases back to 0, so the sky twists while scrolling and
      // settles after; speed itself decays each frame once scrolling stops.
      swirl += (speed - swirl) * 0.08;
      speed *= 0.85;
      if (Math.abs(target - current) < 0.0005) current = target;
      if (Math.abs(swirl) < 0.001 && Math.abs(speed) < 0.001) swirl = speed = 0;
      // Set on the sky itself, not the shell: a custom property changed on the shell would make
      // the browser restyle the whole app every frame.
      const sky = shell.querySelector<HTMLElement>(".ambient-space");
      if (sky) {
        sky.style.setProperty("--pane-progress", current.toFixed(4));
        sky.style.setProperty("--pane-swirl", swirl.toFixed(4));
      }
      raf = current === target && swirl === 0 ? 0 : requestAnimationFrame(step);
    };
    const onScroll = () => {
      // Progress is screens scrolled; speed is screens per event, signed, capped so a flick
      // twists the sky without spinning it.
      target = main.scrollTop / main.clientHeight;
      const delta = (main.scrollTop - lastTop) / main.clientHeight;
      lastTop = main.scrollTop;
      speed = Math.max(-1, Math.min(1, speed + delta * 4));
      if (!raf) raf = requestAnimationFrame(step);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const refreshSyncStatus = useCallback(() => {
    return getSyncStatus()
      .then((status) => setSyncStatus(status))
      .catch(() => {
        // Sync status is a nice-to-have on Settings/Sidebar; don't toast for it.
      });
  }, []);

  useEffect(() => {
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  useEffect(() => {
    if (!syncStatus?.signedIn) return;
    const id = setInterval(refreshSyncStatus, 15000);
    return () => clearInterval(id);
  }, [syncStatus?.signedIn, refreshSyncStatus]);

  function snapshot(): BackEntry<View, BackState> {
    return {
      view,
      scrollTop: mainRef.current?.scrollTop ?? 0,
      state: { query: libraryQuery, sort: librarySort, stats: statsPrefs, statsShown },
    };
  }

  /** Opens a view and remembers the current one, so the back button can return to it. */
  function pushTo(next: View) {
    setBackStack((prev) => pushEntry(prev, snapshot()));
    setView(next);
  }

  /** A page chosen from the rail, sidebar panel, profile or a Settings link: a fresh history. */
  function goTo(next: View) {
    setBackStack(clearStack());
    setView(next);
  }

  function goBack() {
    const popped = popEntry(backStack);
    if (!popped) return;
    // Leaving a release by back drops unsaved edits, exactly as leaving it by the rail does.
    setBackStack(popped.stack);
    setLibraryQuery(popped.entry.state.query);
    setLibrarySort(popped.entry.state.sort);
    setStatsPrefs(popped.entry.state.stats);
    setStatsShown(popped.entry.state.statsShown);
    pendingScroll.current = popped.entry.scrollTop;
    contentReady.current = popped.entry.view.type !== "stats";
    setView(popped.entry.view);
  }

  // Put the scroll back once the earlier page is tall enough (Stats loads its rankings after it
  // mounts); it stops when the user scrolls or presses a key, or after 3 s.
  useLayoutEffect(() => {
    const top = pendingScroll.current;
    if (top === null) return;
    pendingScroll.current = null;
    const main = mainRef.current;
    if (!main) return;
    return runScrollRestore(main, top, () => contentReady.current);
  }, [view]);

  // Cmd+[ and the mouse's back button. Not while typing in a field.
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || e.key !== "[") return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")
      )
        return;
      e.preventDefault();
      goBackRef.current();
    }
    function onMouseUp(e: MouseEvent) {
      if (e.button !== 3) return;
      e.preventDefault();
      goBackRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function handleImported(release: Release) {
    refreshLibrary();
    // Back from a fresh import goes to the Library, not to the used import page.
    setBackStack(
      stackAfterImport({
        view: { type: "library" },
        scrollTop: 0,
        state: { query: libraryQuery, sort: librarySort, stats: statsPrefs, statsShown },
      })
    );
    setView({ type: "release", id: release.id, justImported: release.kind === "album" });
  }

  function handleDeleted() {
    refreshLibrary();
    goTo({ type: "library" });
  }

  function openImport(kind?: ReleaseKind) {
    goTo({ type: "import", kind });
  }

  /** "Back to {name}" for an artist page, resolved from the catalogue ("Back" when it is gone). */
  function backLabelFor(target: View): string {
    return target.type === "artist"
      ? backLabel("artist", catalogEntry(artistCatalog, target.key)?.name)
      : backLabel(target.type);
  }

  // The sidebar highlights the page on screen; a release page is none of them.
  // The Spotify folders' review page belongs to Settings.
  const activePage: SidebarPage | null =
    view.type === "release" || view.type === "artist" || view.type === "collections" ? null : view.type === "adopt" ? "settings" : view.type;

  /** Resolves true once the release is imported, false (after a toast) when it failed. */
  async function handleAcceptFromPhone(id: string): Promise<boolean> {
    try {
      await acceptFromPhone(id);
      showToast("success", "Added to your library");
      await Promise.all([refreshLibrary(), refreshSyncStatus()]);
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to import from your phone");
      return false;
    }
  }

  /** "Send to Spotify" on a friend's share (#182). Resolves true once it is in the library. */
  async function handleAcceptFriend(id: string): Promise<boolean> {
    try {
      await acceptFriendShare(id);
      showToast("success", "Added to your library");
      await Promise.all([refreshLibrary(), refreshSyncStatus()]);
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Couldn't add that share");
      await refreshSyncStatus();
      return false;
    }
  }

  async function handleDismissFriend(id: string): Promise<boolean> {
    try {
      await hideFriendShare(id);
      await refreshSyncStatus();
      return true;
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Couldn't dismiss it");
      return false;
    }
  }

  /** Hide (#295): out of this tray on this Mac, with an Undo. Resolves true once hidden. */
  async function handleHide(id: string): Promise<boolean> {
    try {
      await hideFromTray(id);
      await refreshSyncStatus();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to hide it");
      return false;
    }
    showToast("success", "Hidden. It comes back if your iPhone sends it again.", {
      label: "Undo",
      onClick: () => {
        unhideFromTray(id)
          .then(refreshSyncStatus)
          .catch((e) => showToast("error", e instanceof Error ? e.message : "Failed to undo"));
      },
    });
    return true;
  }

  /** "Resync Mac and phone": reconciles, asks the other devices to upload again, then reloads the tray. */
  async function handleResync(): Promise<ResyncOutcome> {
    try {
      const { asked } = await resyncFromPhone();
      await refreshSyncStatus();
      return asked ? "asked" : "later";
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to ask your phone to resync");
      return "failed";
    }
  }

  return (
    <CollectionsProvider onToast={showToast}>
    <div
      ref={shellRef}
      // The Import page's sky portals in here (#159), so it sits under the sidebar like the library's.
      data-app-shell=""
      className="relative isolate flex h-screen w-screen overflow-hidden"
    >
      {/* The library sky fills the whole window, outside the scroller so it never scrolls away,
          and paints under both the sidebar and the pane. */}
      {((view.type === "library" && (library?.releases.length ?? 0) > 0) || view.type === "adopt") && (
        // The Spotify folders' review page sits in the library's colour space, with the neutral wash.
        <AmbientSpace palette={view.type === "library" ? libraryPalette : null} />
      )}
      <Sidebar
        releases={library?.releases ?? []}
        loading={loadingLibrary}
        activePage={activePage}
        onLibraryClick={() => goTo({ type: "library" })}
        onImportClick={() => openImport()}
        onSettingsClick={() => goTo({ type: "settings" })}
        onProfileClick={() => goTo({ type: "settings", section: "account" })}
        onStatsClick={() => goTo({ type: "stats" })}
        signedIn={syncStatus?.signedIn ?? false}
        email={syncStatus?.email ?? null}
        palette={view.type === "library" ? libraryPalette : null}
      />
      {/* The pane is the sidebar's next sibling: `.sb-stage` pads it for the rail (and the pinned
          panel) and slides it when the panel docks. main stays relative + isolate: the release
          page's AmbientBackdrop paints behind its content but inside this pane, so it never
          covers the sidebar. */}
      <div className="sb-stage relative isolate min-h-0 min-w-0 flex-1">
        <ArtistNavProvider value={{ open: (key) => pushTo({ type: "artist", key }), lockedReason: null }}>
        <main
          ref={mainRef}
          className={`relative isolate h-full overflow-y-auto p-6 md:p-10 lg:p-16 ${
            // Room under the back button where the page's own padding would run into it; at lg
            // the padding already clears it.
            backStack.length > 0 ? "pt-[4.5rem] md:pt-20 lg:pt-16" : ""
          }`}
        >
          {view.type === "library" && (
            <LibraryView
              releases={library?.releases ?? []}
              artistIndex={artistIndex}
              loading={loadingLibrary}
              query={libraryQuery}
              sort={librarySort}
              onQueryChange={setLibraryQuery}
              onSortChange={setLibrarySort}
              onSelectRelease={(id) => pushTo({ type: "release", id })}
              onSelectArtist={(key) => pushTo({ type: "artist", key })}
              catalog={artistCatalog}
              onImport={openImport}
              onBulkDone={refreshLibrary}
              onToast={showToast}
              onAmbientCoverChange={setAmbientCoverUrl}
              onOpenCollection={(id) => pushTo({ type: "collections", id })}
            />
          )}
          {view.type === "collections" && (
            <CollectionsView
              releases={library?.releases ?? []}
              selectedId={view.id}
              onSelect={(id) => setView({ type: "collections", id })}
              onAddTracks={() => goTo({ type: "library" })}
              menuEnv={{
                toast: showToast,
                openRelease: (id) => pushTo({ type: "release", id }),
                openArtist: (name) => pushTo({ type: "artist", key: creditKey(name) }),
              }}
            />
          )}
          {view.type === "import" && (
            <ImportView
              key={view.kind ?? "any"}
              initialKind={view.kind}
              artistIndex={artistIndex}
              onImported={handleImported}
              onToast={showToast}
            />
          )}
          {view.type === "release" && (
            <ReleaseView
              key={view.id}
              releaseId={view.id}
              initialRelease={library?.releases.find((r) => r.id === view.id)}
              justImported={view.justImported ?? false}
              highlightTrackId={view.trackId}
              onDeleted={handleDeleted}
              onUpdated={refreshLibrary}
              onToast={showToast}
              onOpenSettings={() => goTo({ type: "settings" })}
              syncSignedIn={syncStatus?.signedIn ?? false}
              onOpenAccount={() => goTo({ type: "settings", section: "account" })}
              artistIndex={artistIndex}
            />
          )}
          {view.type === "stats" && (
            <StatsView
              releases={library?.releases ?? []}
              loadingLibrary={loadingLibrary}
              prefs={statsPrefs}
              onContentReady={() => {
                contentReady.current = true;
              }}
              shown={statsShown}
              onShownChange={setStatsShown}
              onPrefsChange={(patch) => {
                // A new tab, period or layout starts its ranking at the first page again.
                if ("tab" in patch || "period" in patch || "layout" in patch) setStatsShown(STATS_PAGE_SIZE);
                setStatsPrefs((prev) => ({ ...prev, ...patch }));
              }}
              onOpenRelease={(id, trackId) => pushTo({ type: "release", id, trackId })}
              onOpenArtist={(name) => pushTo({ type: "artist", key: creditKey(name) })}
              onOpenSettings={() => goTo({ type: "settings" })}
              onToast={showToast}
            />
          )}
          {view.type === "artist" &&
            (loadingLibrary ? (
              <p className="text-text-muted">Loading…</p>
            ) : (
              <ArtistView
                entry={catalogEntry(artistCatalog, view.key)}
                releases={library?.releases ?? []}
                onOpenRelease={(id, trackId) => pushTo({ type: "release", id, trackId })}
                onGoToLibrary={() => goTo({ type: "library" })}
              />
            ))}
          {view.type === "settings" && (
            <SettingsView
              onToast={showToast}
              syncStatus={syncStatus}
              onSyncStatusChange={refreshSyncStatus}
              section={view.section}
              onCheckSpotifyFolders={() => pushTo({ type: "adopt", scan: true })}
            />
          )}
          {view.type === "adopt" && (
            <AdoptReviewView
              scan={view.scan}
              onBack={() => (backStack.length > 0 ? goBack() : goTo({ type: "settings" }))}
              onAllAdded={(text) => {
                refreshLibrary();
                goTo({ type: "library" });
                showToast("success", text);
              }}
              onLibraryChanged={refreshLibrary}
            />
          )}
          {/* Room for the mini player (#338) on a page with no release bar; a page with one gets its room, bar and player
              together, from the bar itself (`--bottom-bars-h`, globals.css). 0 high when no player shows. */}
          <div
            aria-hidden
            style={{ height: "calc((var(--mini-player-h, 0px) + min(36px, var(--mini-player-h, 0px))) * var(--no-bar, 1))" }}
          />
        </main>
        </ArtistNavProvider>
        {/* The back button's wrapper has no `left`: an absolute box with left auto starts at the pane's
            padding edge, so it clears the rail (and the pinned panel) the way the page does. */}
        {backStack.length > 0 && (
          <div className="absolute top-4 z-20 ml-4 md:top-6 md:ml-6">
            <BackButton
              label={backLabelFor(backStack[backStack.length - 1].view)}
              onClick={goBack}
            />
          </div>
        )}
        {/* One overlay layer above the pane's chrome (Back, the tray button) for floating panels that must
            not be clipped by or stacked inside the pane, such as the Share popover. The sidebar stays above. */}
        <div id="overlay-root" className="pointer-events-none fixed inset-0 z-30" />
        {/* The player (#338): its one <audio> lives here so playback survives page changes, and its mini bar
            floats above the release bar on every page while a queue exists. The demo has no files to play. */}
        {!IS_DEMO && <Player
            releases={library?.releases ?? []}
            onOpenRelease={(id) => pushTo({ type: "release", id })}
            onOpenCollection={(id) => (view.type === "collections" ? setView({ type: "collections", id }) : pushTo({ type: "collections", id }))}
          />}
        {!IS_DEMO && (
          <div className="absolute right-4 top-4 z-20 md:right-6 md:top-6">
            <PhoneInbox
              pending={syncStatus?.pendingFromPhone ?? []}
              hidden={syncStatus?.hiddenFromTray ?? {}}
              onAccept={handleAcceptFromPhone}
              onHide={handleHide}
              onResync={handleResync}
              friends={syncStatus?.fromFriends ?? []}
              onAcceptFriend={handleAcceptFriend}
              onDismissFriend={handleDismissFriend}
            />
          </div>
        )}
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
    </CollectionsProvider>
  );
}
