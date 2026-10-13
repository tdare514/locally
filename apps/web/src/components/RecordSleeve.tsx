"use client";

import type { ReactNode } from "react";

interface RecordSleeveProps {
  /** The sleeve: the release's cover picker in its `sleeve` presentation. */
  children: ReactNode;
  /** The cover, printed on the record's centre label. Null shows the accent house label. */
  labelUrl: string | null;
  /** Bumped after each successful save; every new value tucks the record into the sleeve
   * and brings it back out spinning. */
  spin: number;
}

/** A record peeking out of its sleeve, the hero of the release page (#112). The disc is
 * decoration only; the sleeve (children) is the interactive cover picker. */
export default function RecordSleeve({ children, labelUrl, spin }: RecordSleeveProps) {
  return (
    <div className="record relative w-fit pr-[92px] sm:pr-[116px]">
      {/* Keyed by `spin` so each save restarts the press and the spin. */}
      <div
        key={spin}
        aria-hidden
        className={`record-disc size-[184px] sm:size-[228px] ${spin > 0 ? "record-pressed" : ""}`}
      >
        <div className={`record-face ${spin > 0 ? "record-spin" : ""}`}>
          <div
            className="record-label"
            style={labelUrl ? { backgroundImage: `url("${labelUrl}")` } : undefined}
          />
        </div>
        <div className="record-sheen" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
