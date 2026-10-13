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
  // The ambient clouds follow the scroll through --pane-progress on the pane wrapper, eased a
  // little each frame toward the scroll position so a fast scroll is followed smoothly. Written
  // straight to the style, not React state, so scrolling never re-renders the app.
  const mainRef = useRef<HTMLElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

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
    const pane = paneRef.current;
    if (!main || !pane) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let current = 0;
    let target = 0;
    const step = () => {
      current += (target - current) * 0.1;
      if (Math.abs(target - current) < 0.0005) current = target;
      pane.style.setProperty("--pane-progress", current.toFixed(4));
      raf = current === target ? 0 : requestAnimationFrame(step);
    };
    const onScroll = () => {
      // Progress is screens scrolled, so every library flows the same per screen; capped where
      // the last cloud has flowed in.
      target = Math.min(2.4, main.scrollTop / main.clientHeight);
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

  async function handleAcceptFromPhone(id: string) {
    try {
      await acceptFromPhone(id);
      showToast("success", "Added to your library");
      await Promise.all([refreshLibrary(), refreshSyncStatus()]);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed to import from your phone");
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden md:flex-row">
      <Sidebar
        releases={library?.releases ?? []}
        loading={loadingLibrary}
        view={view}
        query={libraryQuery}
        sort={librarySort}
        onClearQuery={() => setLibraryQuery("")}
        pendingFromPhone={syncStatus?.pendingFromPhone ?? []}
        onAcceptFromPhone={handleAcceptFromPhone}
        onSelectRelease={(id) => setView({ type: "release", id })}
        onLibraryClick={() => setView({ type: "library" })}
        onImportClick={() => openImport()}
        onSettingsClick={() => setView({ type: "settings" })}
      />
      {/* The wrapper holds the library's AmbientSpace outside the scroller so it never scrolls
          away, and carries --pane-progress (see above) that moves its clouds. main stays relative +
          isolate: the release page's AmbientBackdrop paints behind its content but inside this
          pane, so it never covers the sidebar. */}
      <div ref={paneRef} className="relative isolate min-h-0 min-w-0 flex-1">
        {view.type === "library" && (library?.releases.length ?? 0) > 0 && (
          <AmbientSpace palette={libraryPalette} />
        )}
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
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
