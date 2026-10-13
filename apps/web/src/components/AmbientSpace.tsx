"use client";

import type { CSSProperties } from "react";
import { NEUTRAL_PALETTE, type AmbientPalette } from "../lib/artwork-palette";

/** The library's colour wash (#112). Unlike AmbientBackdrop it sits outside the scrolling pane,
 * so it stays with the screen while the list scrolls; three clouds drift slowly and shift as the
 * pane scrolls. Colours are registered custom properties, so a new cover cross-fades. */
export default function AmbientSpace({ palette }: { palette: AmbientPalette | null }) {
  const p = palette ?? NEUTRAL_PALETTE;
  const style = {
    "--ambient-primary": p.primary,
    "--ambient-secondary": p.secondary,
    "--ambient-deep": p.deep,
  } as CSSProperties;
  return (
    <div aria-hidden className="ambient-space" style={style}>
      {[1, 2, 3].map((n) => (
        <div key={n} className={`ambient-cloud-track ambient-track-${n}`}>
          <div className={`ambient-cloud ambient-cloud-${n}`} />
        </div>
      ))}
    </div>
  );
}
