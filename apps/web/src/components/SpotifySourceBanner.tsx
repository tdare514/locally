"use client";

import { useEffect, useState } from "react";
import { dismissSpotifySource, getSpotifySource, openSpotifySettings } from "../lib/api-client";

interface SpotifySourceBannerProps {
  onOpenSettings: () => void;
  onToast: (kind: "success" | "error", text: string) => void;
}

const STEPS = [
  "Open Spotify settings.",
  'Scroll to "Library" and turn on "Show Local Files".',
  '"Add a source" and choose the folder above.',
];

export default function SpotifySourceBanner({ onOpenSettings, onToast }: SpotifySourceBannerProps) {
  const [libraryDir, setLibraryDir] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSpotifySource()
      .then((status) => {
        if (cancelled) return;
        setLibraryDir(status.libraryDir);
        setWatching(status.watching);
        setDismissed(status.dismissed);
      })
      .catch(() => {
        // Nice-to-have banner; stay hidden on error rather than toast.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopyPath() {
    if (!libraryDir) return;
    try {
      await navigator.clipboard.writeText(libraryDir);
      onToast("success", "Path copied");
    } catch {
      onToast("error", "Failed to copy path");
    }
  }

  async function handleOpenSpotifySettings() {
    setOpening(true);
    try {
      await openSpotifySettings();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to open Spotify settings");
    } finally {
      setOpening(false);
    }
  }

  async function handleDismiss() {
    setDismissing(true);
    try {
      await dismissSpotifySource();
      setDismissed(true);
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save");
    } finally {
      setDismissing(false);
    }
  }

  if (!loaded || !libraryDir || watching || dismissed) return null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border border-l-4 border-l-accent bg-card p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Spotify setup</p>
        <h2 className="mt-1 text-lg font-bold tracking-[-0.03em] text-text">
          Spotify can&apos;t see this yet.
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Spotify only plays local files from folders you add as a source. Add this folder once
          and every import shows up.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-full bg-elevated px-4 py-2 font-mono text-xs text-text">
          {libraryDir}
        </code>
        <button
          type="button"
          onClick={handleCopyPath}
          className="rounded-full border border-text-dim px-4 py-2 text-xs font-medium text-text transition-colors hover:border-text"
        >
          Copy path
        </button>
      </div>

      <ol className="flex flex-col gap-2 text-sm text-text-muted">
        {STEPS.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-text">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={handleOpenSpotifySettings}
          disabled={opening}
          className="w-fit rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {opening ? "Opening…" : "Open Spotify settings"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          className="w-fit rounded-full border border-text-dim px-6 py-3 text-sm font-medium text-text transition-colors hover:border-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {dismissing ? "Saving…" : "Done, I added it"}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-sm font-medium text-text-dim underline-offset-2 hover:text-text hover:underline"
        >
          Full checklist in Settings
        </button>
      </div>
    </div>
  );
}
