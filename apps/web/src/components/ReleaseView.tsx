"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Release, UpdateReleaseMeta } from "../shared/types";
import {
  coverUrl,
  deleteRelease,
  forgetRelease,
  getRelease,
  getSettings,
  getReleasePlays,
  getShareSummary,
  getSpotifyPlaylists,
  openSpotifyPlaylist,
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
import { copyText } from "../lib/copy-text";
import { COPIED_LABEL, COPY_LABEL, PLAYLIST_FALLBACK, playlistSteps } from "../lib/playlist-copy";
import { PLAYS_ACROSS_DEVICES } from "../lib/plays-copy";
import { startPlaylistsPolling } from "../lib/playlists-poll";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import { liftBrightness } from "../lib/artwork-palette";
import { IS_DEMO } from "../lib/demo";
import { UNKNOWN_ARTIST } from "../shared/adopt";
import { folderAfterRoot } from "../lib/adopt-review";
import NoCover from "./NoCover";
import ShareControl from "./ShareControl";
import AddToCollection from "./AddToCollection";
import { deleteSharedLine } from "../lib/share-copy";
import { RESHARE_REFUSED } from "../shared/shares";
import ReleaseBar, { BarConfirm, useBarConfirm } from "./ReleaseBar";
import { PLAY_COUNTED_EVENT } from "./Player";
import { buildReleaseQueue, currentItem, itemKey, playerStore, usePlayerSelector } from "../lib/play-queue";
import { libraryWidthClass } from "../lib/library-view-prefs";
import { useLibraryWidth } from "../lib/use-library-width";
import { usePaneWidth } from "../lib/use-element-size";
import { detailsBesideSleeve } from "../lib/page-layout";
import ArtistCombobox from "./ArtistCombobox";
import type { ArtistEntry } from "../lib/artist-index";
import FeaturingRow from "./FeaturingRow";
import ReleaseDateField from "./ReleaseDateField";
import { initialReleaseDateText, releaseDateTextBlocks } from "../lib/release-date-input";
import { parseReleaseDateText, releaseDateFields, storedReleaseDate } from "../shared/releaseDate";
import ArtistLinks, { ArtistNavProvider, ArtistOpenButton, LOCKED_TIP, useArtistNav } from "./ArtistNav";
import { splitFeaturing } from "../lib/artist-names";
import { releaseTitleForSave, releaseTitleShown, titleForSave, toEditor } from "../lib/featuring-field";

interface ReleaseViewProps {
  releaseId: string;
  /** The release as the library already has it, so the page renders at once instead of
   * flashing "Loading…"; the fresh copy is fetched quietly behind it. */
  initialRelease?: Release;
  justImported?: boolean;
  /** A track to scroll to and highlight once on arrival (opened from the Stats page). */
  highlightTrackId?: string;
  onDeleted: () => void;
  onUpdated: () => void;
  onToast: (kind: "success" | "error", text: string) => void;
  onOpenSettings: () => void;
  /** Signed in to sync: Share is offered only then (#182). */
  syncSignedIn?: boolean;
  /** Opens Settings at the sync account section, for "Sign in to share". */
  onOpenAccount?: () => void;
  /** Every artist in the library, for the Artist field's suggestions (#287). */
  artistIndex: ArtistEntry[];
}

interface Draft {
  title: string;
  artist: string;
  /** The Release date field's text (#221). */
  releaseDate: string;
  genre: string;
  tracks: EditableTrack[];
}

/** The update to send for `draft`, or null when nothing differs from `release`. Track
 * numbers follow list order, so a reorder alone is a change. */
/** The Title input's text: a single's plain title (names go in Featuring), an album's or adopted title as is. */
function shownTitle(r: Release): string {
  return r.kind === "single" && !r.adopted ? releaseTitleShown(r.title) : r.title;
}

/** A stored track as the editor holds it: the plain title and the featured names apart (#287).
 * An adopted release is view mode and keeps its titles as they are. */
export function editableTrack(
  t: { id: string; title: string; discNumber?: number },
  adopted: boolean
): EditableTrack {
  if (adopted) return { key: t.id, title: t.title, discNumber: t.discNumber };
  const { title, featuring } = toEditor(t.title);
  return { key: t.id, title, featuring, discNumber: t.discNumber };
}

export function buildPatch(release: Release, draft: Draft): UpdateReleaseMeta | null {
  const patch: UpdateReleaseMeta = {};
  // A single's Title input shows the plain title; the names are in its Featuring row.
  const releaseTitle = release.kind === "single" && !release.adopted ? releaseTitleForSave(release.title, draft.title) : draft.title;
  if (releaseTitle !== release.title) patch.title = releaseTitle;
  if (draft.artist !== release.artist) patch.artist = draft.artist;

  // The date is set as a whole: `year` with `releaseDate` when it is more precise. Text that is the one the
  // release already shows (an odd old year included) changes nothing; text that is not a date is left out
  // here and blocks Save instead (`releaseDateBlocked`).
  if (draft.releaseDate.trim() !== initialReleaseDateText(release.year, release.releaseDate).trim()) {
    const entry = parseReleaseDateText(draft.releaseDate);
    if (entry.kind === "empty") {
      patch.year = null;
    } else if (entry.kind === "date") {
      const now = releaseDateFields(entry.date);
      const stored = releaseDateFields(storedReleaseDate(release.year, release.releaseDate));
      if (now.year !== stored.year || now.releaseDate !== stored.releaseDate) {
        patch.year = now.year;
        if (now.releaseDate !== undefined) patch.releaseDate = now.releaseDate;
      }
    }
  }

  const genreValue = draft.genre.trim() === "" ? null : draft.genre.trim();
  if (genreValue !== (release.genre ?? null)) patch.genre = genreValue;

  const trackPatches: NonNullable<UpdateReleaseMeta["tracks"]> = [];
  draft.tracks.forEach((t, i) => {
    const original = release.tracks.find((o) => o.id === t.key);
    const trackNumber = i + 1;
    const change: { id: string; title?: string; trackNumber?: number; discNumber?: number | null } = {
      id: t.key,
    };
    let changed = false;
    // The stored title is the plain one joined with the names (Spotify's "Song (feat. B)"); a title the
    // user did not touch is sent as it was.
    const storedTitle = titleForSave(original?.title, t.title, t.featuring ?? []);
    if (!original || original.title !== storedTitle) {
      change.title = storedTitle;
      changed = true;
    }
    if (!original || original.trackNumber !== trackNumber) {
      change.trackNumber = trackNumber;
      changed = true;
    }
    // A track dropped in among another disc's tracks joins that disc.
    if (t.discNumber !== undefined && (!original || original.discNumber !== t.discNumber)) {
      change.discNumber = t.discNumber;
      changed = true;
    } else if (t.discNumber === undefined && original?.discNumber !== undefined) {
      // The discs were joined back into one: clear the stored disc.
      change.discNumber = null;
      changed = true;
    }
    if (changed) trackPatches.push(change);
  });
  if (trackPatches.length > 0) patch.tracks = trackPatches;

  return Object.keys(patch).length === 0 ? null : patch;
}

/** True when the Release date text is something that is not a date: Save waits (#221). Text that is the one the
 * release already shows never blocks. */
export function releaseDateBlocked(release: Release, text: string): boolean {
  if (text.trim() === initialReleaseDateText(release.year, release.releaseDate).trim()) return false;
  return releaseDateTextBlocks(text);
}

/** Genre: a quiet label and an inline value that reads as text until hovered. */
function InlineField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex items-baseline gap-1.5">
      <span className="text-white/70">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        readOnly={IS_DEMO}
        onChange={(e) => onChange(e.target.value)}
        className="field-sizing-content min-w-[4ch] rounded-lg bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}

/** Release date and genre in view mode: the same label and value as InlineField, as plain text. */
function PlainField({ label, value }: { label: string; value: string }) {
  const set = value.trim() !== "";
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-white/70">{label}</span>
      <span className={set ? "font-semibold text-text" : "text-text-dim"}>{set ? value : "Not set"}</span>
    </p>
  );
}

export default function ReleaseView({
  releaseId,
  initialRelease,
  justImported = false,
  highlightTrackId,
  onDeleted,
  onUpdated,
  onToast,
  onOpenSettings,
  syncSignedIn = false,
  onOpenAccount,
  artistIndex,
}: ReleaseViewProps) {
  const artistNav = useArtistNav();
  const [release, setRelease] = useState<Release | null>(initialRelease ?? null);
  const [loading, setLoading] = useState(!initialRelease);
  const [title, setTitle] = useState(initialRelease ? shownTitle(initialRelease) : "");
  const [artist, setArtist] = useState(initialRelease?.artist ?? "");
  const [releaseDate, setReleaseDate] = useState(
    initialRelease ? initialReleaseDateText(initialRelease.year, initialRelease.releaseDate) : ""
  );
  const [genre, setGenre] = useState(initialRelease?.genre ?? "");
  const [tracks, setTracks] = useState<EditableTrack[]>(
    () => initialRelease?.tracks.map((t) => editableTrack(t, initialRelease.adopted === true)) ?? []
  );
  // While a copy is on screen, a load refreshes it quietly instead of flashing "Loading…".
  const shown = useRef<Release | null>(initialRelease ?? null);
  const [saving, setSaving] = useState(false);
  const [replacingCover, setReplacingCover] = useState(false);
  const {
    open: confirmingDelete,
    ask: askDelete,
    cancel: cancelDelete,
    close: closeDeleteConfirm,
    bindOpener: bindDeleteOpener,
  } = useBarConfirm();
  const [deleting, setDeleting] = useState(false);
  // What the delete confirm adds when the release is still shared (#182); asked when the confirm opens.
  const [sharedLine, setSharedLine] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [spin, setSpin] = useState(0);
  // Each track's total plays across devices, by track id (#107). Empty until the one fetch lands.
  const [plays, setPlays] = useState<Record<string, number>>({});
  // The Spotify playlists each track is in, by track id (#212). Empty until connected and read.
  const [playlists, setPlaylists] = useState<Record<string, { id: string; name: string }[]>>({});
  useEffect(() => {
    if (!confirmingDelete || !syncSignedIn) return;
    let cancelled = false;
    getShareSummary(releaseId)
      .then((s) => !cancelled && setSharedLine(deleteSharedLine(s.people, s.link)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [confirmingDelete, syncSignedIn, releaseId]);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A release added from a Spotify folder (#249) opens in view mode: nothing on it is editable.
  const {
    open: confirmingRemove,
    ask: askRemove,
    cancel: cancelRemove,
    bindOpener: bindRemoveOpener,
  } = useBarConfirm();
  const [removing, setRemoving] = useState(false);
  const [adoptRoots, setAdoptRoots] = useState<string[]>([]);
  const isAdopted = release?.adopted === true;
  const [width] = useLibraryWidth();
  const pageRef = useRef<HTMLDivElement>(null);
  const paneWidth = usePaneWidth(pageRef, !loading && release !== null);

  // Selectors, not the whole state: the position ticks four times a second and this page must not render on it.
  const isPlaying = usePlayerSelector((s) => s.playing);
  const currentKey = usePlayerSelector((s) => itemKey(currentItem(s.queue)));
  // Rows that can play: every track whose file is there. The demo has no files.
  const playableKeys = useMemo(
    () => new Set(IS_DEMO || !release ? [] : release.tracks.filter((t) => !t.missing).map((t) => t.id)),
    [release],
  );
  function handleTogglePlay(trackId: string) {
    if (!release) return;
    // The row that is playing pauses (or resumes); any other row starts the release's queue at that track.
    if (currentKey === `${release.id}/${trackId}`) {
      playerStore.toggle();
      return;
    }
    const queue = buildReleaseQueue(release, trackId);
    if (queue) playerStore.start(queue);
  }

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
    setTitle(shownTitle(r));
    setArtist(r.artist);
    setReleaseDate(initialReleaseDateText(r.year, r.releaseDate));
    setGenre(r.genre ?? "");
    setTracks(r.tracks.map((t) => editableTrack(t, r.adopted === true)));
  }, []);

  const load = useCallback(() => {
    if (!shown.current) setLoading(true);
    closeDeleteConfirm();
    getRelease(releaseId)
      .then(applyRelease)
      .catch((e) =>
        onToast("error", e instanceof Error ? e.message : "Failed to load release")
      )
      .finally(() => setLoading(false));
  }, [releaseId, applyRelease, onToast, closeDeleteConfirm]);

  useEffect(() => {
    // Fetch-on-mount: load() sets loading state before its async fetch resolves. ReleaseView is
    // remounted (via `key={releaseId}`) whenever the selected release changes.
    load();
  }, [load]);

  useEffect(() => {
    // The folder line is relative to the Spotify folder, so a view-mode page needs the list once.
    if (!isAdopted || IS_DEMO) return;
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setAdoptRoots(s.adoptRoots);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAdopted]);

  const [playsRefresh, setPlaysRefresh] = useState(0);
  useEffect(() => {
    // A play counted by Locally's own player (#338) on this release: read the totals again.
    const onCounted = (e: Event) => {
      if ((e as CustomEvent<{ releaseId: string }>).detail?.releaseId === releaseId) setPlaysRefresh((n) => n + 1);
    };
    window.addEventListener(PLAY_COUNTED_EVENT, onCounted);
    return () => window.removeEventListener(PLAY_COUNTED_EVENT, onCounted);
  }, [releaseId]);

  useEffect(() => {
    // One request per release page open (ReleaseView is remounted per release), plus one after each play
    // Locally's player counts here; never per row or render, and no polling. A failure just leaves the counts off the page.
    if (IS_DEMO) return;
    let cancelled = false;
    getReleasePlays(releaseId)
      .then(({ tracks: counted }) => {
        if (!cancelled) setPlays(Object.fromEntries(counted.map((t) => [t.trackId, t.total])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [releaseId, playsRefresh]);

  useEffect(() => {
    // The first read can come back empty while the server fills its cache in the background, and
    // a refresh can be held up by a Retry-After, so keep looking until it is done (see
    // playlists-poll.ts), and once more when the window regains focus. A failure leaves the lines off.
    if (IS_DEMO) return;
    const polling = startPlaylistsPolling(
      () => getSpotifyPlaylists(releaseId),
      (res) => setPlaylists(res.connected ? res.tracks : {})
    );
    const onFocus = () => polling.poke();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      polling.stop();
    };
  }, [releaseId]);

  const handleOpenPlaylist = useCallback(
    (id: string) => {
      openSpotifyPlaylist(id).catch((e) =>
        onToast("error", e instanceof Error ? e.message : "Couldn't open the playlist")
      );
    },
    [onToast]
  );

  const hasRelease = release !== null;
  useEffect(() => {
    // Once the rows are on screen: bring the chosen track to the middle and tint its row once.
    // A track that is not in this release (a stale id) does nothing.
    if (!highlightTrackId || !hasRelease) return;
    const row = [...document.querySelectorAll<HTMLElement>(".track-list > li[data-key]")].find(
      (li) => li.dataset.key === highlightTrackId
    );
    if (!row) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    row.dataset.highlight = "";
    // The highlight runs 0.35 s wait + 0.3 s in + 1.2 s hold + 1.2 s out (#413), also the still version under reduced motion.
    const timer = setTimeout(() => delete row.dataset.highlight, 3100);
    return () => {
      clearTimeout(timer);
      delete row.dataset.highlight;
    };
  }, [highlightTrackId, hasRelease]);

  function handleTracksChange(next: EditableTrack[]) {
    setTracks(next);
  }

  async function handleSave() {
    if (!release) return;

    if (releaseDateBlocked(release, releaseDate)) return;
    const patch = buildPatch(release, { title, artist, releaseDate, genre, tracks });
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

  async function handleRemove() {
    if (!release) return;
    setRemoving(true);
    try {
      await forgetRelease(release.id);
      onToast("success", "Removed from Locally");
      onDeleted();
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Couldn't remove it from Locally");
      setRemoving(false);
    }
  }

  if (loading) {
    return <p className="text-text-muted">Loading…</p>;
  }

  if (!release) {
    return <p className="text-text-muted">Release not found.</p>;
  }

  const artistShown = isAdopted && artist.trim() === "" ? UNKNOWN_ARTIST : artist;
  const headerTitle = title.trim() || artistShown.trim() || release.title || release.artist;
  const folderLine = isAdopted ? folderAfterRoot(adoptRoots, release.folderPath) : null;
  const viewTracks = isAdopted
    ? Object.fromEntries(release.tracks.map((t) => [t.id, { durationSec: t.durationSec, missing: t.missing }]))
    : undefined;
  const trackCount = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  const dateBlocked = releaseDateBlocked(release, releaseDate);
  const unsaved = dateBlocked || buildPatch(release, { title, artist, releaseDate, genre, tracks }) !== null;

  // A name on this page opens that artist's page; leaving drops unsaved edits, so while there are
  // some the links are disabled (#288).
  const artistNavHere = { open: artistNav.open, lockedReason: unsaved ? LOCKED_TIP : null };
  // The names a single features, as links in a read-only header; an album has none of its own.
  const headerFeaturing =
    release.kind === "single" && tracks.length > 0
      ? isAdopted
        ? splitFeaturing(tracks[0].title).featuring
        : (tracks[0].featuring ?? [])
      : [];
  const linkedArtist = artist.trim() !== "";
  const beside = detailsBesideSleeve(paneWidth);
  const durations = Object.fromEntries(release.tracks.map((t) => [t.id, t.durationSec]));

  return (
    // The bottom margin cancels the pane's own bottom padding (AppShell's p-6 md:p-10 lg:p-16), so the
    // bar's anchor sits at the pane's bottom edge and the bar stays 24 above it at the end of the scroll.
    <ArtistNavProvider value={artistNavHere}>
    <div ref={pageRef} className={`flex min-h-[calc(100%+1.5rem)] flex-col -mb-6 md:min-h-[calc(100%+2.5rem)] md:-mb-10 lg:min-h-[calc(100%+4rem)] lg:-mb-16 ${libraryWidthClass(width)}`} style={palette ? ({ "--hl-tint": liftBrightness(palette.primary) } as CSSProperties) : undefined}>
      <div className="flex flex-1 flex-col gap-12">
      <AmbientBackdrop palette={palette} />
      {!isAdopted && <SpotifySourceBanner onOpenSettings={onOpenSettings} onToast={onToast} />}

      {/* The record is the hero: the sleeve (cover picker) with the disc peeking out. The details sit
          beside it once the pane is wider than about 900, bottom-aligned to it, and under it below
          that. The actions are in the release bar at the bottom of the pane. */}
      <div className="flex flex-col gap-12">
        <header className={`flex pt-2 lg:pt-4 ${beside ? "flex-row items-end gap-10" : "flex-col gap-8"}`}>
          <RecordSleeve labelUrl={artworkUrl} spin={spin}>
            {isAdopted ? (
              // View mode: the sleeve is only a picture, with no pencil badge and no picker. With no
              // cover it is the note and nothing else.
              <div className="record-sleeve relative size-[200px] overflow-hidden rounded-[4px] bg-card sm:size-[248px]">
                {artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <NoCover className="h-full w-full" />
                )}
              </div>
            ) : (
              <CoverPicker
                file={null}
                existingUrl={artworkUrl}
                onChange={handleReplaceCover}
                disabled={replacingCover}
                readOnly={IS_DEMO}
                presentation="sleeve"
              />
            )}
          </RecordSleeve>

          <div className={`flex min-w-0 flex-col gap-3 ${beside ? "flex-1" : ""}`}>
            {!isAdopted && <h1 className="sr-only">{headerTitle}</h1>}
            <p className="text-sm text-white/70">
              {release.kind === "single" ? "Single" : "Album"} · {trackCount}
            </p>
            {isAdopted ? (
              <>
                <h1 className="max-w-[min(100%,720px)] break-words text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-text sm:text-[44px]">
                  {title.trim() || artistShown}
                </h1>
                <p className="-mt-1 text-xl font-semibold tracking-[-0.02em] text-white/85">
                  {linkedArtist ? <ArtistLinks artist={artistShown} featuring={headerFeaturing} /> : artistShown}
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
                  <PlainField label="Release date" value={releaseDate} />
                  <PlainField label="Genre" value={genre} />
                </div>
                <p className="text-[13px] text-text-muted">
                  {folderLine ? `In your Spotify folder · ${folderLine}` : "In your Spotify folder"}
                </p>
              </>
            ) : (
              <>
            <textarea
              aria-label="Title"
              rows={1}
              value={title}
              readOnly={IS_DEMO}
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
            {IS_DEMO && linkedArtist ? (
              // Read-only (the demo): the plain artist line, every name a link.
              <p className="-mt-1 text-xl font-semibold tracking-[-0.02em] text-white/85">
                <ArtistLinks artist={artist} featuring={headerFeaturing} />
              </p>
            ) : (
              <div className="-mt-1 flex min-w-0 max-w-full items-start gap-1 self-start">
                <ArtistCombobox
                  ariaLabel="Artist"
                  value={artist}
                  readOnly={IS_DEMO}
                  placeholder="Add artist"
                  onChange={setArtist}
                  index={artistIndex}
                  wrapperClassName="-mx-2 max-w-full self-start"
                  hintClassName="self-start"
                  inputClassName="field-sizing-content min-w-[8ch] max-w-full rounded-lg bg-transparent px-2 py-0.5 text-xl font-semibold tracking-[-0.02em] text-white/85 outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent"
                />
                <span className="flex h-8 items-center">
                  <ArtistOpenButton artist={artist} />
                </span>
              </div>
            )}
            {release.kind === "single" && tracks.length > 0 && !IS_DEMO && (
              <FeaturingRow
                names={tracks[0].featuring ?? []}
                onChange={(featuring) => setTracks((prev) => prev.map((t, i) => (i === 0 ? { ...t, featuring } : t)))}
                index={artistIndex}
                readOnly={IS_DEMO}
                linkNames
              />
            )}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
              <ReleaseDateField value={releaseDate} onChange={setReleaseDate} placeholder="Add release date" />
              <InlineField label="Genre" value={genre} onChange={setGenre} placeholder="Add genre" />
            </div>
              </>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold tracking-[-0.03em] text-text">Tracks</h2>
          <TrackList
            tracks={tracks}
            onChange={handleTracksChange}
            readOnly={IS_DEMO || isAdopted}
            view={viewTracks}
            featuringIndex={release.kind === "album" && !isAdopted ? artistIndex : undefined}
            durations={durations}
            releaseArtist={artistShown}
            linkArtists={linkedArtist}
            plays={plays}
            player={
              playableKeys.size > 0
                ? {
                    playableKeys,
                    currentKey: currentKey?.startsWith(`${release.id}/`) ? currentKey.slice(release.id.length + 1) : null,
                    playing: isPlaying,
                    onToggle: handleTogglePlay,
                  }
                : undefined
            }
            playlists={playlists}
            onOpenPlaylist={handleOpenPlaylist}
            renderCollect={
              IS_DEMO
                ? undefined
                : (key, trackName) => (
                    <AddToCollection
                      name={trackName}
                      variant="row"
                      getItems={() => [{ kind: "track", releaseId: release.id, trackId: key }]}
                    />
                  )
            }
            renderShare={
              isAdopted || IS_DEMO || release.sharedFrom
                ? undefined
                : (key, trackName) => (
                    <ShareControl
                      releaseId={release.id}
                      name={trackName}
                      trackIds={[key]}
                      variant="row"
                      signedIn={syncSignedIn}
                      onSignIn={() => (onOpenAccount ?? onOpenSettings)()}
                    />
                  )
            }
          />
          {tracks.some((t) => (plays[t.key] ?? 0) > 0) && (
            <p className="text-xs text-text-muted">{PLAYS_ACROSS_DEVICES}</p>
          )}
        </div>
      </div>


      {release.kind === "album" && (
        <details
          open={justImported}
          className="group rounded-xl border border-border bg-card p-5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-bold tracking-[-0.02em] text-text [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="h-4 w-4 text-text-muted transition-transform motion-reduce:transition-none group-open:rotate-90" />
            Make it a playlist
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-text">{release.title}</span>
              <button
                type="button"
                onClick={handleCopyTitle}
                className="btn-ink"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? COPIED_LABEL : COPY_LABEL}
              </button>
            </div>
            <p className="text-sm text-text-muted">{playlistSteps(release.title, tracks.length)}</p>
            <p className="text-xs text-text-muted">{PLAYLIST_FALLBACK}</p>
          </div>
        </details>
      )}
      </div>

      <ReleaseBar
        label="Release actions"
        left={
          isAdopted ? (
            confirmingRemove ? (
              // The release page's confirm style, without the red: the files stay where they are.
              <BarConfirm
                message="Remove from Locally? The files stay in your Spotify folder, and Check for new files can add it back."
                onCancel={cancelRemove}
                disabled={removing}
              >
                <button type="button" onClick={handleRemove} disabled={removing} className="btn-save">
                  {removing ? "Removing…" : "Remove"}
                </button>
              </BarConfirm>
            ) : (
              <button ref={bindRemoveOpener} type="button" onClick={askRemove} className="btn-ink">
                Remove from Locally
              </button>
            )
          ) : confirmingDelete ? (
            <BarConfirm message={sharedLine && syncSignedIn ? `Delete this release? ${sharedLine}` : "Delete this release?"} onCancel={cancelDelete}>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="btn-danger"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            </BarConfirm>
          ) : (
            <button
              ref={bindDeleteOpener}
              type="button"
              onClick={askDelete}
              disabled={IS_DEMO}
              title={IS_DEMO ? "Not available in the demo" : undefined}
              className="btn-ink-danger"
            >
              Delete
            </button>
          )
        }
        status={unsaved && !IS_DEMO && !confirmingDelete && !isAdopted ? "Unsaved changes" : undefined}
        beforeMain={
          <>
          {!IS_DEMO && (
            <AddToCollection
              name={release.title}
              variant="bar"
              getItems={() => [{ kind: "release", releaseId: release.id }]}
            />
          )}
          {isAdopted ? undefined : (
            <>
              {!IS_DEMO && release.sharedFrom?.allowReshare === false && (
                // Imported from a friend's share that was not allowed to go on (#328): quiet text, no button.
                <span className="text-sm text-text-muted">{RESHARE_REFUSED}</span>
              )}
              {!IS_DEMO && release.sharedFrom?.allowReshare !== false && (
                <ShareControl
                  releaseId={release.id}
                  name={release.title}
                  variant="bar"
                  signedIn={syncSignedIn}
                  onSignIn={() => (onOpenAccount ?? onOpenSettings)()}
                />
              )}
              <button
                type="button"
                onClick={handleReveal}
                disabled={IS_DEMO}
                title={IS_DEMO ? "Not available in the demo" : undefined}
                className="btn-ink"
              >
                Show in Finder
              </button>
            </>
          )}
          </>
        }
        main={
          isAdopted ? (
            <button type="button" onClick={handleReveal} disabled={IS_DEMO} className="btn-save">
              Show in Finder
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || IS_DEMO || dateBlocked}
              title={IS_DEMO ? "Not available in the demo" : dateBlocked ? "Fix the release date first" : undefined}
              className="btn-save"
            >
              {saving ? "Saving…" : "Save to library"}
            </button>
          )
        }
      />
    </div>
    </ArtistNavProvider>
  );
}
