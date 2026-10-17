"use client";

import type { CSSProperties } from "react";
import type { ReleaseKind } from "../../shared/types";
import CoverPicker from "../CoverPicker";
import RecordSleeve from "../RecordSleeve";
import TrackList, { type EditableTrack } from "../TrackList";
import ArtistCombobox from "../ArtistCombobox";
import type { ArtistEntry } from "../../lib/artist-index";

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
  year: string;
  onYearChange: (value: string) => void;
  genre: string;
  onGenreChange: (value: string) => void;
  tracks: EditableTrack[];
  onTracksChange: (tracks: EditableTrack[]) => void;
  onRemoveTrack: (index: number) => void;
  inspecting: boolean;
  coverFile: File | null;
  onCover: (file: File) => void;
  beat: { stage: BeatStage; replay: boolean; discKey: string };
  /** The cover, printed on the disc's centre label. */
  labelUrl: string | null;
  /** The cover's colour, for the glow of the dock's buttons. */
  tint: string | undefined;
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
        className={`field-sizing-content ${minWidth} rounded-md bg-transparent px-1.5 py-0.5 font-semibold text-text outline-none transition-colors placeholder:font-normal placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${UNDERLINE}`}
      />
    </label>
  );
}

/** The release page (#112) with the record being made: the sleeve and disc, blank inline fields,
 * the tracks and the dock. A cover is the moment: it slides in, the light flashes, the disc tucks
 * away (the beat, driven by `beat` and globals.css `.imp-*`). */
export default function ImportRecord({
  kind,
  onKindChange,
  title,
  onTitleChange,
  artist,
  onArtistChange,
  year,
  onYearChange,
  genre,
  onGenreChange,
  tracks,
  onTracksChange,
  onRemoveTrack,
  inspecting,
  coverFile,
  onCover,
  beat,
  labelUrl,
  tint,
  canSubmit,
  importing,
  onSubmit,
  onAddTrack,
  artistIndex,
}: ImportRecordProps) {
  const trackCount = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  // The wrapper's class is how the beat reaches the disc inside RecordSleeve.
  const stateClass = beat.stage === "playing" ? "imp-beat" : beat.stage === "settled" ? "imp-rest" : "";

  return (
    <div className="imp-page-in mx-auto flex w-full max-w-[920px] flex-col gap-12 pb-16">
      <div className="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start lg:gap-x-10">
        <header className="flex flex-col gap-8 pt-2 lg:col-start-1 lg:row-start-1 lg:pt-4">
          <div className={stateClass} data-replay={beat.replay ? "true" : undefined}>
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
              inputClassName={`field-sizing-content min-w-[16ch] max-w-full rounded-md bg-transparent px-2 py-0.5 text-xl font-semibold tracking-[-0.02em] text-white/85 outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${UNDERLINE}`}
            />
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
              <InlineField
                label="Year"
                value={year}
                onChange={onYearChange}
                placeholder="Add year"
                inputMode="numeric"
                minWidth="min-w-[8ch]"
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

        {/* The dock, as on the release page, with the import actions. Faked glass, not
            backdrop-blur: the colour sky drifts behind it before there is a cover. The sticky
            offset is the release page's (see ReleaseView). */}
        <div
          style={tint ? ({ "--btn-tint": tint } as CSSProperties) : undefined}
          className="sticky top-4 z-10 -my-4 flex w-fit max-w-full flex-wrap items-center gap-2 self-start rounded-[26px] glass-fake glass-dock p-1.5 pr-3 sm:rounded-full lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:my-0 lg:w-auto lg:flex-col lg:items-stretch lg:gap-1 lg:rounded-[26px] lg:p-2"
        >
          <button type="button" onClick={onSubmit} disabled={!canSubmit} className="btn-save">
            {importing ? "Adding…" : "Add to library"}
          </button>
          <button type="button" onClick={onAddTrack} disabled={importing} className="btn-ink">
            <span className="btn-ink-label">Add a track</span>
          </button>
        </div>

        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold tracking-[-0.03em] text-text">Tracks</h2>
            {inspecting && <p className="text-xs text-text-muted">Reading tags…</p>}
          </div>
          <TrackList tracks={tracks} onChange={onTracksChange} onRemove={onRemoveTrack} />
        </div>
      </div>
    </div>
  );
}
