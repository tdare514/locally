"use client";

import type { CSSProperties, ReactNode } from "react";
import { useDelayedFlag } from "../lib/use-delayed-flag";

/**
 * Still placeholders for a real wait (#422, docs/design.md rule 10): blocks shaped like the content, in `card`,
 * no shimmer and no motion. `Skeleton` holds the place from the first frame, so the page never jumps, and
 * draws its blocks only once the wait has passed 300 ms. `className` lays the blocks out as the content would be.
 * The region is `aria-busy`; one screen-reader status line beside it says the label once the blocks show, and the
 * blocks themselves are hidden from assistive tech.
 */
export function Skeleton({
  busy = true,
  label,
  className = "",
  style,
  children,
}: {
  busy?: boolean;
  /** Read out once the blocks show, e.g. "Loading your stats". */
  label: string;
  className?: string;
  style?: CSSProperties;
  /** The blocks, laid out in the content's own shape and size. */
  children?: ReactNode;
}) {
  const shown = useDelayedFlag(busy);
  return (
    <>
      <span role="status" className="sr-only">
        {shown ? label : ""}
      </span>
      <div aria-busy={busy || undefined} className={`${className} ${shown ? "" : "invisible"}`.trim()} style={style}>
        {children}
      </div>
    </>
  );
}

/** One still block. Radii follow design rule 8: 8 for bars and tiles by default; pass a class for 4 (covers) or 12. */
export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`block rounded-[8px] bg-card ${className}`} style={style} />;
}
