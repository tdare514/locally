"use client";

import { useRef, useState } from "react";
import RecordSleeve from "../../RecordSleeve";
import TrackList, { type EditableTrack } from "../../TrackList";
import CoverSleeve from "./CoverSleeve";
import type { SampleCover } from "./sampleCovers";

interface MakeRecordProps {
  /** Fade the page in (it arrived from the invitation). */
  enter: boolean;
  cover: SampleCover | null;
  /** The cover is landing now (keyframes run). False with a cover shows the finished record. */
  beat: boolean;
  /** The finished record, reached by letting the beat play out or by jumping to its end. Switching
   * to it remounts the record, so the disc lands in the sleeve at once instead of gliding. */
  finished: boolean;
  /** The cover for the disc's centre label; it appears as the disc starts to turn. */
  labelUrl: string | null;
  onPickCover: () => void;
}

const SAMPLE_TRACKS: EditableTrack[] = [
  { key: "s1", title: "Low tide" },
  { key: "s2", title: "Salt on the glass" },
  { key: "s3", title: "Slow light" },
];

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

/** The release page (#112) with nothing in it yet: the sleeve and disc, blank inline fields and
 * the tracks. The cover is the moment: it slides in, develops, and the disc tucks away. */
export default function MakeRecord({
  enter,
  cover,
  beat,
  finished,
  labelUrl,
  onPickCover,
}: MakeRecordProps) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [tracks, setTracks] = useState<EditableTrack[]>(SAMPLE_TRACKS);
  const nextKey = useRef(1);

  const trackCount = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  // The wrapper's class is how the beat reaches the disc inside RecordSleeve.
  const stateClass = cover === null ? "" : beat ? "imp-beat" : "imp-rest";

  function addSampleTrack() {
    setTracks((t) => [...t, { key: `n${nextKey.current++}`, title: `Track ${t.length + 1}` }]);
  }

  return (
    <div className={`${enter ? "imp-page-in " : ""}mx-auto flex max-w-[920px] flex-col gap-12 pb-16`}>
      <div className="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start lg:gap-x-10">
        <header className="flex flex-col gap-8 pt-2 lg:col-start-1 lg:row-start-1 lg:pt-4">
          <div key={finished ? "end" : "run"} className={stateClass}>
            <RecordSleeve labelUrl={labelUrl} spin={0}>
              <CoverSleeve cover={cover} beat={beat} onPick={onPickCover} />
            </RecordSleeve>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="sr-only">New release</h1>
            <p className="text-sm text-white/70">
              {tracks.length === 1 ? "Single" : "Album"} · {trackCount}
            </p>
            <textarea
              aria-label="Title"
              rows={1}
              value={title}
              placeholder="Title"
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              className={`field-sizing-content -mx-2 max-w-[min(100%,720px)] min-w-[12ch] resize-none self-start rounded-lg bg-transparent px-2 py-1 text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-text outline-none transition-colors placeholder:text-white/40 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent sm:text-[44px] ${UNDERLINE}`}
            />
            <input
              aria-label="Artist"
              value={artist}
              placeholder="Artist"
              onChange={(e) => setArtist(e.target.value)}
              className={`field-sizing-content -mx-2 -mt-1 min-w-[16ch] max-w-full self-start rounded-md bg-transparent px-2 py-0.5 text-xl font-semibold tracking-[-0.02em] text-white/85 outline-none transition-colors placeholder:text-white/50 hover:bg-white/[0.07] focus:bg-white/10 focus:ring-2 focus:ring-accent ${UNDERLINE}`}
            />
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]">
              <InlineField label="Year" value={year} onChange={setYear} placeholder="Add year" inputMode="numeric" minWidth="min-w-[8ch]" />
              <InlineField label="Genre" value={genre} onChange={setGenre} placeholder="Add genre" minWidth="min-w-[12ch]" />
            </div>
          </div>
        </header>

        {/* The dock, as on the release page, with the import actions. Prototype: neither saves.
            Faked glass, not backdrop-blur: the colour sky drifts behind it before there is a cover. */}
        <div className="glass-fake sticky top-4 z-10 -my-4 flex w-fit max-w-full flex-wrap items-center gap-2 self-start rounded-[26px] p-1.5 pr-3 sm:rounded-full lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:my-0 lg:w-auto lg:flex-col lg:items-stretch lg:gap-1 lg:rounded-[26px] lg:p-2">
          <button
            type="button"
            className="rounded-full bg-accent px-7 py-2.5 text-sm font-bold text-black transition-colors hover:bg-accent-hover active:scale-95"
          >
            Add to library
          </button>
          <button
            type="button"
            onClick={addSampleTrack}
            className="rounded-full px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-white/10"
          >
            Add a track
          </button>
        </div>

        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
          <h2 className="text-lg font-bold tracking-[-0.03em] text-text">Tracks</h2>
          <TrackList
            tracks={tracks}
            onChange={setTracks}
            onRemove={(i) => setTracks((t) => t.filter((_, idx) => idx !== i))}
          />
        </div>
      </div>
    </div>
  );
}
