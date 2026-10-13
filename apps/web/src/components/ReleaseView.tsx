"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Release, UpdateReleaseMeta } from "../shared/types";
import {
  coverUrl,
  deleteRelease,
  getRelease,
  replaceCover,
  reveal,
  updateRelease,
} from "../lib/api-client";
import TrackList, { type EditableTrack } from "./TrackList";
import CoverPicker from "./CoverPicker";
import RecordSleeve from "./RecordSleeve";
import AmbientBackdrop from "./AmbientBackdrop";
import SpotifySourceBanner from "./SpotifySourceBanner";
import { ChevronRightIcon, CopyIcon } from "./Icons";
import { COPIED_LABEL, COPY_LABEL, PLAYLIST_FALLBACK, playlistSteps } from "../lib/playlist-copy";
import { useArtworkPalette } from "../lib/use-artwork-palette";

interface ReleaseViewProps {
  releaseId: string;
  /** The release as the library already has it, so the page renders at once instead of
   * flashing "Loading…"; the fresh copy is fetched quietly behind it. */
  initialRelease?: Release;
  justImported?: boolean;
  onDeleted: () => void;
  onUpdated: () => void;
  onToast: (kind: "success" | "error", text: string) => void;
  onOpenSettings: () => void;
}

/** Copies `text` from a user gesture: the async Clipboard API first, then the
 * legacy `execCommand("copy")` path for hosts that deny `clipboard-write`. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

interface Draft {
  title: string;
  artist: string;
  year: string;
  genre: string;
  tracks: EditableTrack[];
}

/** The update to send for `draft`, or null when nothing differs from `release`. Track
 * numbers follow list order, so a reorder alone is a change. */
function buildPatch(release: Release, draft: Draft): UpdateReleaseMeta | null {
  const patch: UpdateReleaseMeta = {};
  if (draft.title !== release.title) patch.title = draft.title;
  if (draft.artist !== release.artist) patch.artist = draft.artist;

  const yearValue = draft.year.trim() === "" ? null : draft.year.trim();
  if (yearValue !== (release.year ?? null)) patch.year = yearValue;

  const genreValue = draft.genre.trim() === "" ? null : draft.genre.trim();
  if (genreValue !== (release.genre ?? null)) patch.genre = genreValue;

  const trackPatches: NonNullable<UpdateReleaseMeta["tracks"]> = [];
  draft.tracks.forEach((t, i) => {
    const original = release.tracks.find((o) => o.id === t.key);
    const trackNumber = i + 1;
    const change: { id: string; title?: string; trackNumber?: number } = {
      id: t.key,
    };
    let changed = false;
    if (!original || original.title !== t.title) {
      change.title = t.title;
      changed = true;
    }
    if (!original || original.trackNumber !== trackNumber) {
      change.trackNumber = trackNumber;
      changed = true;
    }
    if (changed) trackPatches.push(change);
  });
  if (trackPatches.length > 0) patch.tracks = trackPatches;

  return Object.keys(patch).length === 0 ? null : patch;
}

/** Year and genre: a quiet label and an inline value that reads as text until hovered. */
function InlineField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: "numeric";
}) {
  return (
    <label className="flex items-baseline gap-1.5">
      <span className="text-white/70">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="field-sizing-content min-w-[4ch] rounded-md bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}

export default function ReleaseView({
  releaseId,
  initialRelease,
  justImported = false,
  onDeleted,
  onUpdated,
  onToast,
  onOpenSettings,
}: ReleaseViewProps) {
  const [release, setRelease] = useState<Release | null>(initialRelease ?? null);
  const [loading, setLoading] = useState(!initialRelease);
  const [title, setTitle] = useState(initialRelease?.title ?? "");
  const [artist, setArtist] = useState(initialRelease?.artist ?? "");
  const [year, setYear] = useState(initialRelease?.year ?? "");
  const [genre, setGenre] = useState(initialRelease?.genre ?? "");
  const [tracks, setTracks] = useState<EditableTrack[]>(
    () => initialRelease?.tracks.map((t) => ({ key: t.id, title: t.title })) ?? []
  );
  // While a copy is on screen, a load refreshes it quietly instead of flashing "Loading…".
  const shown = useRef<Release | null>(initialRelease ?? null);
  const [saving, setSaving] = useState(false);
  const [replacingCover, setReplacingCover] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [spin, setSpin] = useState(0);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const artworkUrl = release?.coverPath ? coverUrl(release.id, release.updatedAt) : null;
  const palette = useArtworkPalette(artworkUrl);

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  const handleCopyTitle = useCallback(async () => {
    if (!release) return;
    if (!(await copyText(release.title))) {
      onToast("error", "Couldn't copy the name");
      return;
    }
    setCopied(true);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 2000);
  }, [release, onToast]);

  const applyRelease = useCallback((r: Release) => {
    shown.current = r;
    setRelease(r);
    setTitle(r.title);
    setArtist(r.artist);
    setYear(r.year ?? "");
    setGenre(r.genre ?? "");
    setTracks(r.tracks.map((t) => ({ key: t.id, title: t.title })));
  }, []);

  const load = useCallback(() => {
    if (!shown.current) setLoading(true);
    setConfirmingDelete(false);
    getRelease(releaseId)
      .then(applyRelease)
      .catch((e) =>
        onToast("error", e instanceof Error ? e.message : "Failed to load release")
      )
      .finally(() => setLoading(false));
  }, [releaseId, applyRelease, onToast]);

  useEffect(() => {
    // Fetch-on-mount: load() sets loading state before its async fetch resolves. ReleaseView is
    // remounted (via `key={releaseId}`) whenever the selected release changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleTracksChange(next: EditableTrack[]) {
    setTracks(next);
  }

  async function handleSave() {
    if (!release) return;

    const patch = buildPatch(release, { title, artist, year, genre, tracks });
    if (!patch) {
      onToast("success", "Nothing to save");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateRelease(release.id, patch);
      applyRelease(updated);
      setSpin((n) => n + 1);
      onToast("success", "Saved to your library");
      onUpdated();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleReplaceCover(file: File) {
    if (!release) return;
    setReplacingCover(true);
    try {
      const updated = await replaceCover(release.id, file);
      applyRelease(updated);
      onToast("success", "Cover updated");
      onUpdated();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to replace cover");
    } finally {
      setReplacingCover(false);
    }
  }

  async function handleReveal() {
    if (!release) return;
    try {
      await reveal(release.folderPath);
      onToast("success", "Opened in Finder");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to open Finder");
    }
  }

  async function handleDelete() {
    if (!release) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteRelease(release.id);
      onToast("success", "Release deleted");
      onDeleted();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Failed to delete release");
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-text-muted">Loading…</p>;
  }

  if (!release) {
    return <p className="text-text-muted">Release not found.</p>;
  }

  const headerTitle = title.trim() || artist.trim() || release.title || release.artist;
  const trackCount = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  const unsaved = buildPatch(release, { title, artist, year, genre, tracks }) !== null;

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-12 pb-16">
      <AmbientBackdrop palette={palette} />
      <SpotifySourceBanner onOpenSettings={onOpenSettings} onToast={onToast} />

      {/* The record is the hero: the sleeve (cover picker) with the disc peeking out, and the
          details set directly under it as inline text rather than a form (#112). */}
      <header className="flex flex-col gap-8 pt-2">
        <RecordSleeve labelUrl={artworkUrl} spin={spin}>
          <CoverPicker
            file={null}
            existingUrl={artworkUrl}
            onChange={handleReplaceCover}
            disabled={replacingCover}
            presentation="sleeve"
          />
        </RecordSleeve>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="sr-only">{headerTitle}</h1>
          <p className="text-sm text-white/70">
            {release.kind === "single" ? "Single" : "Album"} · {trackCount}
          </p>
          <textarea
            aria-label="Title"
            rows={1}
            value={title}
            placeholder="Untitled"
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="field-sizing-content -mx-2 max-w-[min(100%,720px)] resize-none rounded-lg bg-transparent px-2 py-1 text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-text outline-none transition-colors placeholder:text-white/40 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent sm:text-[44px]"
          />
          <input
            aria-label="Artist"
            value={artist}
            placeholder="Add artist"
            onChange={(e) => setArtist(e.target.value)}
            className="field-sizing-content -mx-2 -mt-1 min-w-[8ch] max-w-full self-start rounded-md bg-transparent px-2 py-0.5 text-xl font-semibold tracking-[-0.02em] text-white/85 outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
          />
          <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
            <InlineField
              label="Year"
              value={year}
              onChange={setYear}
              placeholder="Add year"
              inputMode="numeric"
            />
            <InlineField label="Genre" value={genre} onChange={setGenre} placeholder="Add genre" />
          </div>
        </div>
      </header>

      {/* Dock: sits under the details, then pins to the top of the pane so the save action stays
          in reach while you edit the tracks below. */}
      <div className="sticky top-4 z-10 -my-4 flex w-fit max-w-full flex-wrap items-center gap-2 self-start rounded-[26px] bg-black/70 p-1.5 pr-3 sm:rounded-full shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur-xl">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-accent px-7 py-2.5 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save to library"}
        </button>
        {unsaved && !confirmingDelete && (
          <span className="px-1 text-xs text-text-muted">Unsaved changes</span>
        )}
        <button
          type="button"
          onClick={handleReveal}
          className="rounded-full px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-white/10"
        >
          Show in Finder
        </button>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="pl-1 text-text-muted">Delete this release?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-full px-4 py-2 text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-full px-3 py-2.5 text-sm font-semibold text-danger transition-colors hover:bg-white/10"
          >
            Delete
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-bold tracking-[-0.03em] text-text">Tracks</h2>
        <TrackList tracks={tracks} onChange={handleTracksChange} />
      </div>

      {release.kind === "album" && (
        <details
          open={justImported}
          className="group rounded-[9px] border border-border bg-card p-5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-bold tracking-[-0.02em] text-text [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="h-4 w-4 text-text-muted transition-transform group-open:rotate-90" />
            Make it a playlist
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-text">{release.title}</span>
              <button
                type="button"
                onClick={handleCopyTitle}
                className="inline-flex items-center gap-1.5 rounded-full border border-text-dim px-4 py-1.5 text-xs font-medium text-text transition-colors hover:border-text"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? COPIED_LABEL : COPY_LABEL}
              </button>
            </div>
            <p className="text-sm text-text-muted">{playlistSteps(release.title, tracks.length)}</p>
            <p className="text-xs text-text-dim">{PLAYLIST_FALLBACK}</p>
          </div>
        </details>
      )}

    </div>
  );
}
