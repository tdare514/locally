"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Library, Release } from "../shared/types";
import { getLibrary } from "../lib/api-client";
import Sidebar from "./Sidebar";
import ImportView from "./ImportView";
import ReleaseView from "./ReleaseView";
import SettingsView from "./SettingsView";
import Toast, { type ToastMessage } from "./Toast";

export type View =
  | { type: "import" }
  | { type: "release"; id: string }
  | { type: "settings" };

export default function AppShell() {
  const [view, setView] = useState<View>({ type: "import" });
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
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

  function handleImported(release: Release) {
    refreshLibrary();
    setView({ type: "release", id: release.id });
  }

  function handleDeleted() {
    refreshLibrary();
    setView({ type: "import" });
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden md:flex-row">
      <Sidebar
        releases={library?.releases ?? []}
        loading={loadingLibrary}
        view={view}
        onSelectRelease={(id) => setView({ type: "release", id })}
        onImportClick={() => setView({ type: "import" })}
        onSettingsClick={() => setView({ type: "settings" })}
      />
      <main className="flex-1 overflow-y-auto p-6 md:p-10">
        {view.type === "import" && (
          <ImportView onImported={handleImported} onToast={showToast} />
        )}
        {view.type === "release" && (
          <ReleaseView
            key={view.id}
            releaseId={view.id}
            onDeleted={handleDeleted}
            onUpdated={refreshLibrary}
            onToast={showToast}
          />
        )}
        {view.type === "settings" && <SettingsView onToast={showToast} />}
      </main>
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
