"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Library, Release, ReleaseKind, SyncStatus } from "../shared/types";
import { acceptFromPhone, getLibrary, getSyncStatus } from "../lib/api-client";
import Sidebar from "./Sidebar";
import LibraryView from "./LibraryView";
import ImportView from "./ImportView";
import ReleaseView from "./ReleaseView";
import SettingsView from "./SettingsView";
import type { LibrarySort } from "../lib/library-sections";
import AmbientSpace from "./AmbientSpace";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import PhoneInbox from "./PhoneInbox";
import Toast, { type ToastMessage } from "./Toast";

export type View =
  | { type: "library" }
  | { type: "import"; kind?: ReleaseKind }
  | { type: "release"; id: string; justImported?: boolean }
  | { type: "settings" };

export default function AppShell() {
  const [view, setView] = useState<View>({ type: "library" });
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  // Lives here (not in LibraryView) so the query survives opening a release and coming back.
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySort, setLibrarySort] = useState<LibrarySort>("newest");
  // The cover LibraryView wants the ambient space tinted by; the wash lives out here so it
  // sits outside the scrolling pane.
  const [ambientCoverUrl, setAmbientCoverUrl] = useState<string | null>(null);
  const libraryPalette = useArtworkPalette(view.type === "library" ? ambientCoverUrl : null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);
  // The library sky follows the scroll through --pane-progress and --pane-swirl on the sky
  // element (which fills the whole window, under the sidebar too), eased each frame so it twists while scrolling and settles after. Written
  // straight to the style, not React state, so scrolling never re-renders the app.
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((kind: "success" | "error", text: string) => {
    nextToastId.current += 1;
    const id = nextToastId.current;
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
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

  function handleImported(release: Release) {
    refreshLibrary();
    setView({ type: "release", id: release.id, justImported: release.kind === "album" });
  }

  function handleDeleted() {
    refreshLibrary();
    setView({ type: "library" });
  }

  function openImport(kind?: ReleaseKind) {
    setView({ type: "import", kind });
  }

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

  return (
    <div
      ref={shellRef}
      className="relative isolate flex h-screen w-screen flex-col overflow-hidden md:flex-row"
    >
      {/* The library sky fills the whole window, outside the scroller so it never scrolls away,
          and paints under both the sidebar and the pane. */}
      {view.type === "library" && (library?.releases.length ?? 0) > 0 && (
        <AmbientSpace palette={libraryPalette} />
      )}
      <Sidebar
        releases={library?.releases ?? []}
        loading={loadingLibrary}
        view={view}
        query={libraryQuery}
        sort={librarySort}
        onClearQuery={() => setLibraryQuery("")}
        onSelectRelease={(id) => setView({ type: "release", id })}
        onLibraryClick={() => setView({ type: "library" })}
        onImportClick={() => openImport()}
        onSettingsClick={() => setView({ type: "settings" })}
        signedIn={syncStatus?.signedIn ?? false}
        email={syncStatus?.email ?? null}
      />
      {/* main stays relative + isolate: the release page's AmbientBackdrop paints behind its
          content but inside this pane, so it never covers the sidebar. */}
      <div className="relative isolate min-h-0 min-w-0 flex-1">
        <main
          ref={mainRef}
          className="relative isolate h-full overflow-y-auto p-6 md:p-10 lg:p-16"
        >
          {view.type === "library" && (
            <LibraryView
              releases={library?.releases ?? []}
              loading={loadingLibrary}
              query={libraryQuery}
              sort={librarySort}
              onQueryChange={setLibraryQuery}
              onSortChange={setLibrarySort}
              onSelectRelease={(id) => setView({ type: "release", id })}
              onImport={openImport}
              onBulkDone={refreshLibrary}
              onToast={showToast}
              onAmbientCoverChange={setAmbientCoverUrl}
            />
          )}
          {view.type === "import" && (
            <ImportView
              key={view.kind ?? "any"}
              initialKind={view.kind}
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
              onDeleted={handleDeleted}
              onUpdated={refreshLibrary}
              onToast={showToast}
              onOpenSettings={() => setView({ type: "settings" })}
            />
          )}
          {view.type === "settings" && (
            <SettingsView
              onToast={showToast}
              syncStatus={syncStatus}
              onSyncStatusChange={refreshSyncStatus}
            />
          )}
        </main>
        <div className="absolute right-4 top-4 z-20 md:right-6 md:top-6">
          <PhoneInbox
            pending={syncStatus?.pendingFromPhone ?? []}
            onAccept={handleAcceptFromPhone}
          />
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
