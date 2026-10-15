"use client";

/* The sample covers are data URIs; next/image's optimizer can't take them (same as CoverPicker). */
/* eslint-disable @next/next/no-img-element */

import { ImagePlusIcon } from "../../Icons";
import type { SampleCover } from "./sampleCovers";

interface CoverSleeveProps {
  cover: SampleCover | null;
  /** True while the chosen cover is landing: the beat's keyframes run. False shows it at rest. */
  beat: boolean;
  onPick: () => void;
}

const LAYER = "absolute inset-0 size-full object-cover";

/** The cover as it lands in the sleeve: a pre-blurred, drained copy slides in from the right and
 * the sharp image fades in over it, like a print developing. The blur is baked into the first
 * image and only the layers' opacity and position ever animate. */
function CoverLayers({ cover, beat }: { cover: SampleCover; beat: boolean }) {
  // Same tree at rest, so jumping to the end state keeps the sharp image on screen.
  return (
    <div className={`absolute inset-0 ${beat ? "imp-cover" : ""}`}>
      {beat && <img src={cover.blurSrc} alt="" className={`imp-blur ${LAYER}`} />}
      <img src={cover.src} alt="" className={`${beat ? "imp-sharp " : ""}${LAYER}`} />
    </div>
  );
}

/** The sleeve of the record being made: the release page's `sleeve` cover picker (same frame,
 * same empty state) without the file input or crop dialog, so a click or drop just chooses the
 * next sample cover. Rendered as the child of RecordSleeve. */
export default function CoverSleeve({ cover, beat, onPick }: CoverSleeveProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={cover ? "Cover art" : "Add cover art"}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onPick();
      }}
      className="record-sleeve relative flex size-[200px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[4px] bg-card text-center outline-none focus-visible:ring-2 focus-visible:ring-accent sm:size-[248px]"
    >
      {(cover === null || beat) && (
        <div className={`flex flex-col items-center gap-2 px-6 ${cover ? "imp-empty-out" : ""}`}>
          <ImagePlusIcon className="h-8 w-8 text-text-muted" />
          <p className="text-sm font-semibold text-text">Add cover art</p>
          <p className="text-xs leading-snug text-text-muted">Drop an image or click to choose</p>
        </div>
      )}
      {cover && <CoverLayers key={cover.id} cover={cover} beat={beat} />}
    </div>
  );
}
