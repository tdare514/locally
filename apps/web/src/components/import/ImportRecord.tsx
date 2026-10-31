"use client";

import type { ReleaseKind } from "../../shared/types";
import type { SendStage } from "../../lib/import-flow";
import CoverPicker from "../CoverPicker";
import RecordSleeve from "../RecordSleeve";
import TrackList, { type EditableTrack } from "../TrackList";
import ArtistCombobox from "../ArtistCombobox";
import ReleaseBar from "../ReleaseBar";
import { libraryWidthClass } from "../../lib/library-view-prefs";
import { useLibraryWidth } from "../../lib/use-library-width";
import type { ArtistEntry } from "../../lib/artist-index";
import FeaturingRow from "../FeaturingRow";
import ReleaseDateField from "../ReleaseDateField";

/** What the page shows of the cover beat: nothing before a cover, "playing" while it runs,
 * "settled" once it has ended or been skipped. */
export type BeatStage = "none" | "playing" | "settled";

interface ImportRecordProps {
  kind: ReleaseKind;
  onKindChange: (kind: ReleaseKind) => void;
  title: string;
  onTitleChange: (value: string) => void;
  artist: string;
  onArtistChange: (value: string) => void;
  releaseDate: string;
  onReleaseDateChange: (value: string) => void;
  genre: string;
  onGenreChange: (value: string) => void;
  tracks: EditableTrack[];
  onTracksChange: (tracks: EditableTrack[]) => void;
  onRemoveTrack: (index: number) => void;
  inspecting: boolean;
  coverFile: File | null;
  onCover: (file: File) => void;
  beat: { stage: BeatStage; discKey: string };
  /** The send (#421): the disc seals into the sleeve while the request runs, and slides back out if it fails. */
  send: SendStage;
  /** The cover, printed on the disc's centre label. */
  labelUrl: string | null;
  canSubmit: boolean;
  importing: boolean;
  onSubmit: () => void;
  onAddTrack: () => void;
  /** Every artist in the library, for the Artist field's suggestions (#287). */
  artistIndex: ArtistEntry[];
}

/* An empty field is a faint underline, so the page reads as a record waiting to be filled
 * rather than a form. The rest is ReleaseView's inline-field style (that one is not exported). */
const UNDERLINE =
  "placeholder-shown:bg-[linear-gradient(rgb(255_255_255/0.22),rgb(255_255_255/0.22))] placeholder-shown:bg-[length:100%_1px] placeholder-shown:bg-bottom placeholder-shown:bg-no-repeat";

function InlineField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  minWidth,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: "numeric";
  /** The blank's length, so an empty field reads as a line to write on. */
  minWidth: string;
}) {
  return (
    <label className="flex items-baseline gap-1.5">
      <span className="text-white/70">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className={`field-sizing-content ${minWidth} rounded-lg bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${UNDERLINE}`}
      />
    </label>
  );
}

/** The release page (#112) with the record being made: the sleeve and disc, blank inline fields,
 * the tracks and the release bar (#294). A cover is the moment: it slides in, the light flashes, the label turns
 * into place (the beat, driven by `beat` and globals.css `.imp-*`); Send seals the disc into the sleeve (`send`). */
export default function ImportRecord({
  kind,
  onKindChange,
  title,
  onTitleChange,
  artist,
  onArtistChange,
  releaseDate,
  onReleaseDateChange,
  genre,
  onGenreChange,
  tracks,
  onTracksChange,
  onRemoveTrack,
  inspecting,
  coverFile,
  onCover,
  beat,
  send,
  labelUrl,
  canSubmit,
  importing,
  onSubmit,
  onAddTrack,
  artistIndex,
}: ImportRecordProps) {
  const [width] = useLibraryWidth();
  const trackCount = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  // The wrapper's class is how the beat and the send reach the disc inside RecordSleeve. The send comes
  // first; after a failed send the disc rests peeking (imp-rest) even with no cover, so its entrance never replays.
  const stateClass =
    send === "sealing"
      ? "imp-sealing"
      : send === "unsealing"
        ? "imp-unsealing"
        : beat.stage === "playing"
          ? "imp-beat"
          : beat.stage === "settled" || send === "failed"
            ? "imp-rest"
            : "";

  return (
    // The bottom margin cancels the pane's own bottom padding (AppShell's p-6 md:p-10 lg:p-16), so the
    // bar's anchor sits at the pane's bottom edge. The bar is outside `imp-page-in`: it never fades in.
    <div className={`flex flex-1 flex-col -mb-6 md:-mb-10 lg:-mb-16 ${libraryWidthClass(width)}`}>
    <div className="imp-page-in flex flex-1 flex-col gap-12">
      <div className="flex flex-col gap-12">
        <header className="flex flex-col gap-8 pt-2 lg:pt-4">
          <div className={stateClass}>
            <RecordSleeve labelUrl={labelUrl} spin={0} discKey={beat.discKey}>
              <CoverPicker
                file={coverFile}
                onChange={onCover}
                disabled={importing}
                presentation="sleeve"
                beat={beat.stage === "playing" ? "playing" : "settled"}
              />
            </RecordSleeve>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="sr-only">Import</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/70">
              <div role="group" aria-label="Release type" className="btn-seg">
                <span aria-hidden className="btn-seg-dot">
                  <span />
                </span>
                <button
                  type="button"
                  onClick={() => onKindChange("single")}
                  aria-pressed={kind === "single"}
                  className="btn-seg-opt"
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => onKindChange("album")}
                  aria-pressed={kind === "album"}
                  className="btn-seg-opt"
                >
                  Album
                </button>
              </div>
              <span>{trackCount}</span>
            </div>
            <textarea
              aria-label="Title"
              rows={1}
              value={title}
              placeholder={kind === "single" ? "Same as track title" : "Album title"}
              onChange={(e) => onTitleChange(e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className={`field-sizing-content -mx-2 max-w-[min(100%,720px)] min-w-[12ch] resize-none self-start rounded-lg bg-transparent px-2 py-1 text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-text outline-none transition-colors placeholder:text-white/40 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent sm:text-[44px] ${UNDERLINE}`}
            />
            <ArtistCombobox
              ariaLabel="Artist"
              value={artist}
              placeholder="Artist"
              onChange={onArtistChange}
              index={artistIndex}
              wrapperClassName="-mx-2 -mt-1 max-w-full self-start"
              hintClassName="self-start"
              inputClassName={`field-sizing-content min-w-[16ch] max-w-full rounded-lg bg-transparent px-2 py-0.5 text-xl font-semibold tracking-[-0.02em] text-white/85 outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${UNDERLINE}`}
            />
            {kind === "single" && tracks.length > 0 && (
              <FeaturingRow
                names={tracks[0].featuring ?? []}
                onChange={(featuring) => onTracksChange(tracks.map((t, i) => (i === 0 ? { ...t, featuring } : t)))}
                index={artistIndex}
                inputExtraClassName={UNDERLINE}
              />
            )}
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
              <ReleaseDateField
                value={releaseDate}
                onChange={onReleaseDateChange}
                placeholder="Add release date"
                minWidth="min-w-[16ch]"
                inputExtraClassName={UNDERLINE}
              />
              <InlineField
                label="Genre"
                value={genre}
                onChange={onGenreChange}
                placeholder="Add genre"
                minWidth="min-w-[12ch]"
              />
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold tracking-[-0.03em] text-text">Tracks</h2>
            {inspecting && <p className="text-xs text-text-muted">Reading tags…</p>}
          </div>
          <TrackList
            tracks={tracks}
            onChange={onTracksChange}
            onRemove={onRemoveTrack}
            releaseArtist={artist}
            featuringIndex={kind === "album" ? artistIndex : undefined}
          />
        </div>
      </div>
    </div>

    <ReleaseBar
      label="Import actions"
      left={
        <button type="button" onClick={onAddTrack} disabled={importing} className="btn-ink">
          Add a track
        </button>
      }
      main={
        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="btn-save">
          {importing ? "Sending…" : "Send to Spotify"}
        </button>
      }
    />
    </div>
  );
}
