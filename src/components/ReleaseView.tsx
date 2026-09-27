"use client";

import { useCallback, useEffect, useState } from "react";
import type { Release, UpdateReleaseMeta } from "../lib/types";
import {
  coverUrl,
  deleteRelease,
  getRelease,
  replaceCover,
  reveal,
  updateRelease,
} from "../lib/api-client";
import Field from "./Field";
import TrackList, { type EditableTrack } from "./TrackList";
import CoverPicker from "./CoverPicker";

interface ReleaseViewProps {
  releaseId: string;
  onDeleted: () => void;
  onUpdated: () => void;
  onToast: (kind: "success" | "error", text: string) => void;
}

export default function ReleaseView({
  releaseId,
  onDeleted,
  onUpdated,
  onToast,
}: ReleaseViewProps) {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [tracks, setTracks] = useState<EditableTrack[]>([]);
  const [saving, setSaving] = useState(false);
  const [replacingCover, setReplacingCover] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const applyRelease = useCallback((r: Release) => {
    setRelease(r);
    setTitle(r.title);
    setArtist(r.artist);
    setYear(r.year ?? "");
    setGenre(r.genre ?? "");
    setTracks(r.tracks.map((t) => ({ key: t.id, title: t.title })));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
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

    const patch: UpdateReleaseMeta = {};
    if (title !== release.title) patch.title = title;
    if (artist !== release.artist) patch.artist = artist;

    const yearValue = year.trim() === "" ? null : year.trim();
    if (yearValue !== (release.year ?? null)) patch.year = yearValue;

    const genreValue = genre.trim() === "" ? null : genre.trim();
    if (genreValue !== (release.genre ?? null)) patch.genre = genreValue;

    const trackPatches: NonNullable<UpdateReleaseMeta["tracks"]> = [];
    tracks.forEach((t, i) => {
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

    if (Object.keys(patch).length === 0) {
      onToast("success", "Nothing to save");
      return;
    }

    setSaving(true);
    try {
      const updated = await updateRelease(release.id, patch);
      applyRelease(updated);
      onToast("success", "Saved");
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-16">
      <div className="flex flex-col gap-4 sm:flex-row">
        <CoverPicker
          file={null}
          existingUrl={
            release.coverPath ? coverUrl(release.id, release.updatedAt) : null
          }
          onChange={handleReplaceCover}
          disabled={replacingCover}
        />
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-elevated px-3 py-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {release.kind === "single" ? "Single" : "Album"}
            </span>
          </div>
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Artist" value={artist} onChange={setArtist} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year" value={year} onChange={setYear} />
            <Field label="Genre" value={genre} onChange={setGenre} />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-text-muted">Tracks</p>
        <TrackList tracks={tracks} onChange={handleTracksChange} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={handleReveal}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-text"
        >
          Show in Finder
        </button>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">Delete this release?</span>
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
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:border-danger"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
