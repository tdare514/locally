"use client";

/* The sample covers are data URIs; next/image's optimizer can't take them (same as CoverPicker). */
/* eslint-disable @next/next/no-img-element */

import { ImagePlusIcon } from "../../Icons";
import type { SampleCover } from "./sampleCovers";
import type { Variant } from "./ImportPrototype";

interface CoverSleeveProps {
  variant: Variant;
  cover: SampleCover | null;
  /** True while the chosen cover is landing: the variant's keyframes run. False shows it at rest. */
  beat: boolean;
  onPick: () => void;
}

const LAYER = "absolute inset-0 size-full object-cover";

/** The cover as it lands in the sleeve. V1 and V2 move one image; V3 stacks a pre-blurred copy
 * under the sharp one and only ever animates their opacity. */
function CoverLayers({ variant, cover, beat }: { variant: Variant; cover: SampleCover; beat: boolean }) {
  if (variant === 3 && beat) {
    return (
      <>
        <img src={cover.blurSrc} alt="" className={`imp3-blur ${LAYER}`} />
        <img src={cover.src} alt="" className={`imp3-sharp ${LAYER}`} />
      </>
    );
  }
  // V2 is not clipped by the sleeve, so the drop and the 1.04 scale show past its edge.
  const round = variant === 2 ? "rounded-[inherit] " : "";
  return <img src={cover.src} alt="" className={`${beat ? `imp${variant}-cover ` : ""}${round}${LAYER}`} />;
}

/** The sleeve of the record being made: the release page's `sleeve` cover picker (same frame,
 * same empty state) without the file input or crop dialog, so a click or drop just chooses the
 * next sample cover. Rendered as the child of RecordSleeve. */
export default function CoverSleeve({ variant, cover, beat, onPick }: CoverSleeveProps) {
  return (
    <>
      {/* V2: one soft pulse under the sleeve as the cover lands. Opacity only. */}
      {variant === 2 && beat && <div aria-hidden className="imp2-shadow" />}
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
        className={`record-sleeve relative flex size-[200px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-card text-center outline-none focus-visible:ring-2 focus-visible:ring-accent sm:size-[248px] ${
          variant === 2 && beat ? "overflow-visible" : "overflow-hidden"
        }`}
      >
        {(cover === null || beat) && (
          <div className={`flex flex-col items-center gap-2 px-6 ${cover ? "imp-empty-out" : ""}`}>
            <ImagePlusIcon className="h-8 w-8 text-text-muted" />
            <p className="text-sm font-semibold text-text">Add cover art</p>
            <p className="text-xs leading-snug text-text-muted">Drop an image or click to choose</p>
          </div>
        )}
        {cover && <CoverLayers key={cover.id} variant={variant} cover={cover} beat={beat} />}
      </div>
    </>
  );
}
