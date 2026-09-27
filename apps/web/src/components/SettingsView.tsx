"use client";

import { useEffect, useState } from "react";
import { getSettings, putSettings, reveal } from "../lib/api-client";
import Field from "./Field";

interface SettingsViewProps {
  onToast: (kind: "success" | "error", text: string) => void;
}

const STEPS = [
  'Open Spotify and go to Settings.',
  'Scroll to the "Library" section.',
  'Turn on "Show Local Files".',
  '"Add a source" and pick your library folder (below).',
];

export default function SettingsView({ onToast }: SettingsViewProps) {
  const [libraryDir, setLibraryDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => setLibraryDir(s.libraryDir))
      .catch((e) =>
        onToast("error", e instanceof Error ? e.message : "Failed to load settings")
      )
      .finally(() => setLoading(false));
  }, [onToast]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await putSettings(libraryDir.trim());
      setLibraryDir(updated.libraryDir);
      onToast("success", "Settings saved");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleReveal() {
    try {
      await reveal();
      onToast("success", "Opened in Finder");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to open Finder");
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-16">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Local Library
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-[-0.02em] text-text">Settings</h1>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <p className="text-sm font-bold text-text">Library folder</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Path"
              value={libraryDir}
              onChange={setLibraryDir}
              placeholder="~/Music/Spotify Local Import"
              disabled={loading}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleReveal}
              className="rounded-full border border-text-dim px-6 py-3 text-sm font-medium text-text transition-colors hover:border-text"
            >
              Show in Finder
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <p className="text-sm font-semibold text-text">Connect to Spotify</p>
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
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-6 text-sm text-text-muted">
        <p>
          Spotify caches local-file metadata. After editing an existing track here,{" "}
          <strong className="text-text">restart Spotify</strong> to see the changes.
        </p>
        <p>
          Non-mp3 files are converted to 320&nbsp;kbps mp3 on import, because Spotify&apos;s
          Local Files only reads mp3 (and mp4/m4a) files.
        </p>
      </section>
    </div>
  );
}
