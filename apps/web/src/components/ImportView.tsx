"use client";

import { useEffect, useReducer, useRef, useState, type DragEvent } from "react";
import type { ImportMeta, Release, ReleaseKind } from "../shared/types";
import { importRelease, inspectFiles } from "../lib/api-client";
import AmbientBackdrop from "./AmbientBackdrop";
import ImportInvitation from "./import/ImportInvitation";
import ImportRecord from "./import/ImportRecord";
import ImportSky from "./import/ImportSky";
import { IS_DEMO } from "../lib/demo";
import type { AmbientPalette } from "../lib/artwork-palette";
import {
  INITIAL_BEAT,
  INVITE_PALETTE,
  SEND,
  beatReducer,
  beatTimes,
  discKeyFor,
  isAudioFile,
  isPlaying,
  mayBeAudioDrag,
  planAdd,
  sealRemaining,
  trimForKind,
  type SendStage,
} from "../lib/import-flow";
import { applyTrackEdits } from "../lib/track-order";
import type { ArtistEntry } from "../lib/artist-index";
import { libraryWidthClass } from "../lib/library-view-prefs";
import { useLibraryWidth } from "../lib/use-library-width";
import { useArtworkPalette } from "../lib/use-artwork-palette";
import { useObjectUrl } from "../lib/use-object-url";
import { usePrefersReducedMotion } from "../lib/use-reduced-motion";
import { orderByDisc } from "../shared/discs";
import { fromEditor, fromInspected, releaseTitleShown } from "../lib/featuring-field";
import type { EditableTrack } from "./TrackList";
import { fieldsFromText, releaseDateTextBlocks } from "../lib/release-date-input";
import { releaseDateText } from "../shared/releaseDate";

interface ImportViewProps {
  /** Prefill Single | Album when opened from the library empty-state CTAs. */
  initialKind?: ReleaseKind;
  onImported: (release: Release) => void;
  onToast: (kind: "success" | "error", text: string) => void;
  /** Every artist in the library, for the Artist field's suggestions (#287). */
  artistIndex: ArtistEntry[];
}

interface Entry {
  /** Stable local key, assigned once when the file is added — survives reordering. */
  key: string;
  file: File;
  /** The plain title; the featured names are kept apart in `featuring` (#287). */
  title: string;
  featuring: string[];
  /** From the file's disc tag, when it has one. */
  discNumber?: number;
  /** From the file's own track tag; only used to order a multi-disc import. */
  tagTrackNumber?: number;
}

/** Resolves after `ms`, at once when there is nothing to wait for. */
function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => window.setTimeout(resolve, ms)) : Promise.resolve();
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

export default function ImportView({
  initialKind,
  onImported,
  onToast,
  artistIndex,
}: ImportViewProps) {
  const [width] = useLibraryWidth();
  const [kind, setKind] = useState<ReleaseKind>(initialKind ?? "single");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [genre, setGenre] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  // The send (#421): the disc seals into the sleeve while the request runs. `sendRun` numbers the sends so
  // a slide back out after a failure gives way to a newer send.
  const [sendStage, setSendStage] = useState<SendStage>("idle");
  const sendRun = useRef(0);
  // Audio is being dragged over the pane.
  const [dragOver, setDragOver] = useState(false);
  // The record replaces the invitation once a track is added, and stays even if all are removed.
  const [started, setStarted] = useState(false);

  // The cover beat (#159): see lib/import-flow.ts and the .imp-* rules in globals.css.
  const [beat, dispatchBeat] = useReducer(beatReducer, INITIAL_BEAT);
  const playing = isPlaying(beat);
  const reducedMotion = usePrefersReducedMotion();
  const times = beatTimes(reducedMotion);
  // The run whose colour wash has started (it starts with the flash, not with the cover).
  const [washedRun, setWashedRun] = useState(0);
  // The palette the backdrop shows: the calm invite tones until a cover's colours arrive, then
  // those (the previous cover's, while a replacement's wash waits for its flash).
  const [shown, setShown] = useState<AmbientPalette>(INVITE_PALETTE);

  const coverUrl = useObjectUrl(coverFile);
  const livePalette = useArtworkPalette(coverUrl);
  const washOn = washedRun === beat.run;
  const washPalette = beat.hasCover && livePalette && (washOn || !playing) ? livePalette : null;
  if (washPalette && washPalette !== shown) setShown(washPalette);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const nextKeyRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => setWashedRun(beat.run), times.washAt);
    return () => window.clearTimeout(id);
  }, [playing, beat.run, times.washAt]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => dispatchBeat({ type: "end" }), times.endAt);
    return () => window.clearTimeout(id);
  }, [playing, beat.run, times.endAt]);

  // Input never waits for the beat: a click or key press anywhere jumps it to the end. The event
  // itself carries on (typing still types, a button still clicks).
  useEffect(() => {
    if (!playing) return;
    const skip = () => dispatchBeat({ type: "skip" });
    const skipOnKey = (e: KeyboardEvent) => {
      if (!e.repeat) skip();
    };
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skipOnKey, true);
    return () => {
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skipOnKey, true);
    };
  }, [playing]);

  function newKey(): string {
    nextKeyRef.current += 1;
    return `f${nextKeyRef.current}`;
  }

  function switchKind(next: ReleaseKind) {
    if (next === kind) return;
    setKind(next);
    setEntries((prev) => trimForKind(prev, next));
  }

  function chooseCover(file: File) {
    setCoverFile(file);
    dispatchBeat({ type: "cover" });
  }

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((f) => f.size > 0);
    if (incoming.length === 0) return;

    const { files: filesToUse, startIndex, replace } = planAdd(kind, entries.length, incoming);

    const optimistic: Entry[] = filesToUse.map((f) => ({
      key: newKey(),
      file: f,
      title: stripExtension(f.name),
      featuring: [],
    }));

    setStarted(true);
    setEntries((prev) => (replace ? optimistic : [...prev, ...optimistic]));

    setInspecting(true);
    try {
      const res = await inspectFiles(filesToUse);
      setEntries((prev) => {
        const next = prev.slice();
        res.files.forEach((info, i) => {
          const idx = startIndex + i;
          if (next[idx]) {
            // "Song (feat. B)" shows split, and an artist tag "A feat. B" adds B to this track.
            const filled = fromInspected(info, stripExtension(next[idx].file.name));
            next[idx] = {
              ...next[idx],
              title: filled.title,
              featuring: filled.featuring,
              discNumber: info.discNumber ?? undefined,
              tagTrackNumber: info.trackNumber ?? undefined,
            };
          }
        });
        // Files tagged with a disc go in (disc, track) order; untagged files keep the order they came in.
        // Only this batch is reordered, so rows the user already arranged stay where they are.
        const end = startIndex + res.files.length;
        return [
          ...next.slice(0, startIndex),
          ...orderByDisc(next.slice(startIndex, end)),
          ...next.slice(end),
        ];
      });

      if (startIndex === 0) {
        const first = res.files[0];
        if (first) {
          setArtist((prev) => prev || fromInspected(first, "").artist);
          setTitle((prev) => prev || (kind === "single" ? releaseTitleShown(first.album ?? "") : first.album) || "");
          setReleaseDate((prev) => prev || releaseDateText(first.year, first.releaseDate));
          setGenre((prev) => prev || first.genre || "");
        }
      }
    } catch (e) {
      onToast(
        "error",
        e instanceof Error ? e.message : "Failed to read file tags"
      );
    } finally {
      setInspecting(false);
    }
  }

  function handleTracksChange(tracks: EditableTrack[]) {
    setEntries((prev) => applyTrackEdits(prev, tracks));
  }

  function handleRemove(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  const hasArtist = artist.trim().length > 0;
  const dateBlocked = releaseDateTextBlocks(releaseDate);
  const canSubmit = entries.length > 0 && hasArtist && !dateBlocked && !importing;

  // After a failed send the disc slides back out. It waits for the seal to finish first, so it is never
  // cut off halfway, and gives way if another send has started.
  async function slideBackOut(run: number, startedAt: number) {
    await pause(sealRemaining(Date.now() - startedAt, reducedMotion));
    if (sendRun.current !== run) return;
    if (reducedMotion) {
      setSendStage("failed");
      return;
    }
    setSendStage("unsealing");
    await pause(SEND.unsealMs);
    if (sendRun.current === run) setSendStage("failed");
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    sendRun.current += 1;
    const run = sendRun.current;
    const startedAt = Date.now();
    setImporting(true);
    // The disc starts sealing into the sleeve at once; with reduced motion it doesn't move.
    if (!reducedMotion) setSendStage("sealing");
    let failed = false;
    try {
      // The stored track title is the catalogue form "Song (feat. B)"; the release title stays plain, so
      // a single with no title of its own gets its track's plain title (the server would copy the joined one).
      const releaseTitle = title.trim() || (kind === "single" ? entries[0]?.title.trim() || "Track 1" : "");
      const meta: ImportMeta = {
        kind,
        title: releaseTitle,
        artist: artist.trim(),
        ...(fieldsFromText(releaseDate) ?? {}),
        genre: genre.trim() || undefined,
        tracks: entries.map((e, i) => ({
          title: fromEditor(e.title.trim() || `Track ${i + 1}`, e.featuring),
          trackNumber: i + 1,
          ...(e.discNumber !== undefined ? { discNumber: e.discNumber } : {}),
        })),
      };
      const release = await importRelease(
        meta,
        entries.map((e) => e.file),
        coverFile
      );
      // The Added moment fires once the seal has finished and the request has succeeded (at once
      // under reduced motion): the toast, then the release page, then the form reset.
      await pause(sealRemaining(Date.now() - startedAt, reducedMotion));
      onToast("success", "Sent to Spotify. It's in Your Library, under Local Files.");
      onImported(release);
      setEntries([]);
      setCoverFile(null);
      dispatchBeat({ type: "reset" });
      setStarted(false);
      setTitle("");
      setArtist("");
      setReleaseDate("");
      setGenre("");
      setKind("single");
      setSendStage("idle");
    } catch (e) {
      failed = true;
      onToast("error", e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
    if (failed) await slideBackOut(run, startedAt);
  }

  if (IS_DEMO) {
    return (
      <div className={`flex flex-col gap-3 pb-16 ${libraryWidthClass(width)}`}>
        <h1 className="text-4xl font-bold tracking-[-0.02em] text-text">Import</h1>
        <p className="text-base text-text-muted">
          Importing isn&apos;t available in the demo. Browse the sample library instead.
        </p>
      </div>
    );
  }

  // Dropping audio anywhere on the pane adds it; anything else (an image on the sleeve) is left to
  // whatever it landed on.
  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    // Any file drag is claimed so a stray drop never navigates away; only audio lights the pane.
    e.preventDefault();
    if (mayBeAudioDrag(Array.from(e.dataTransfer.items))) setDragOver(true);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const audio = Array.from(e.dataTransfer.files).filter(isAudioFile);
    if (audio.length > 0 && !importing) void addFiles(audio);
  }

  const beatStage = !beat.hasCover ? "none" : playing ? "playing" : "settled";
  const tracks: EditableTrack[] = entries.map((e) => ({
    key: e.key,
    title: e.title,
    featuring: e.featuring,
    discNumber: e.discNumber,
  }));

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={handleDrop}
      className="flex min-h-full flex-col"
    >
      {/* A replacement cover never brings the blue sky back or restarts the wash's fade-in: the old
          colours cross-fade to the new ones in place. */}
      <ImportSky state={beatStage === "none" ? "on" : playing && !beat.replay ? "out" : "off"} />
      {/* The cover's colours wash the pane. Not positioned itself, so this and the accent wash
          below fill <main>, as the release page's backdrop does. */}
      {beat.hasCover && (
        <div aria-hidden className="imp-backdrop-in" data-beat={playing && !beat.replay}>
          <AmbientBackdrop key={beat.skipped ? "skipped" : undefined} palette={shown} />
        </div>
      )}
      {started ? (
        <ImportRecord
          kind={kind}
          onKindChange={switchKind}
          title={title}
          onTitleChange={setTitle}
          artist={artist}
          onArtistChange={setArtist}
          releaseDate={releaseDate}
          onReleaseDateChange={setReleaseDate}
          genre={genre}
          onGenreChange={setGenre}
          tracks={tracks}
          onTracksChange={handleTracksChange}
          onRemoveTrack={handleRemove}
          inspecting={inspecting}
          coverFile={coverFile}
          onCover={chooseCover}
          beat={{ stage: beatStage, discKey: discKeyFor(beat) }}
          send={sendStage}
          labelUrl={beat.hasCover ? coverUrl : null}
          canSubmit={canSubmit}
          importing={importing}
          onSubmit={handleSubmit}
          onAddTrack={() => audioInputRef.current?.click()}
          artistIndex={artistIndex}
        />
      ) : (
        <>
          <ImportInvitation over={dragOver} onAdd={() => audioInputRef.current?.click()} />
          {/* #122: the Import pill's accent, swept left to right across the pane. */}
          <div aria-hidden className="imp-wash">
            <div className="imp-wash-band" />
          </div>
        </>
      )}
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.aiff,.aif"
        multiple={kind === "album"}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files ?? []);
          e.target.value = "";
        }}
      />
    </div>
  );
}
