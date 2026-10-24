"use client";

import type { ReactNode } from "react";

interface RecordSleeveProps {
  /** The sleeve: the release's cover picker in its `sleeve` presentation. */
  children: ReactNode;
  /** The cover, printed on the record's centre label. Null shows the black label. */
  labelUrl: string | null;
  /** Bumped after each successful save; every new value tucks the record into the sleeve
   * and brings it back out spinning. */
  spin: number;
  /** Optional. A new value remounts the disc and leaves the sleeve alone: the Import page (#159)
   * uses it to restart the disc's beat for a new cover, and to land the disc in the sleeve at once
   * when input skips the beat. */
  discKey?: string;
  /** The collection page (#369): true turns the record, false holds it at its angle. Leave it out and the disc
   * only spins after a save, as on the release page. */
  turning?: boolean;
}

/** A record peeking out of its sleeve, the hero of the release page (#112). The disc is
 * decoration only; the sleeve (children) is the interactive cover picker. */
export default function RecordSleeve({ children, labelUrl, spin, discKey, turning }: RecordSleeveProps) {
  return (
    <div className="record relative w-fit pr-[92px] sm:pr-[116px]">
      {/* Keyed by `spin` so each save restarts the press and the spin. */}
      <div
        key={discKey === undefined ? spin : `${spin}:${discKey}`}
        aria-hidden
        className={`record-disc size-[184px] sm:size-[228px] ${spin > 0 ? "record-pressed" : ""}`}
      >
        <div className={`record-face ${spin > 0 ? "record-spin" : ""} ${turning === undefined ? "" : "record-turn"}`} data-turning={turning}>
          <div
            className={`record-label ${labelUrl ? "" : "record-label-bare"}`}
            style={labelUrl ? { backgroundImage: `url("${labelUrl}")` } : undefined}
          />
        </div>
        <div className="record-sheen" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
