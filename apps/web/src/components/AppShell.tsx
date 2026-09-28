"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Library, Release, ReleaseKind, SyncStatus } from "../shared/types";
import { acceptFromPhone, getLibrary, getSyncStatus } from "../lib/api-client";
import Sidebar from "./Sidebar";
import LibraryView from "./LibraryView";
import ImportView from "./ImportView";
import ReleaseView from "./ReleaseView";
import SettingsView from "./SettingsView";
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextToastId = useRef(0);

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

  const refreshLibrary = useCallback(() => {
    setLoadingLibrary(true);
    return getLibrary()
      .then((lib) => setLibrary(lib))
      .catch((e) =>
        showToast("error", e instanceof Error ? e.message : "Failed to load library")
      )
      .finally(() => setLoadingLibrary(false));
  }, [showToast]);

  useEffect(() => {
    // Fetch-on-mount: refreshLibrary sets loading state before its async fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        pendingFromPhone={syncStatus?.pendingFromPhone ?? []}
        onAcceptFromPhone={handleAcceptFromPhone}
        onSelectRelease={(id) => setView({ type: "release", id })}
        onLibraryClick={() => setView({ type: "library" })}
        onImportClick={() => openImport()}
        onSettingsClick={() => setView({ type: "settings" })}
      />
      <main className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-16">
        {view.type === "library" && (
          <LibraryView
            releases={library?.releases ?? []}
            loading={loadingLibrary}
            onSelectRelease={(id) => setView({ type: "release", id })}
            onImport={openImport}
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
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
