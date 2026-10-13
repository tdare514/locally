"use client";

import type { CSSProperties } from "react";
import { NEUTRAL_PALETTE, type AmbientPalette } from "../lib/artwork-palette";

/** The library's colour wash (#112). Unlike AmbientBackdrop it sits outside the scrolling pane,
 * so it stays with the screen while the list scrolls; one continuous colour sky that twists as you
 * scroll and settles when you stop, through `--pane-progress` and `--pane-swirl` (set by AppShell). Colours are registered custom properties, so
 * a new cover cross-fades. */
export default function AmbientSpace({ palette }: { palette: AmbientPalette | null }) {
  const p = palette ?? NEUTRAL_PALETTE;
  const style = {
    "--ambient-primary": p.primary,
    "--ambient-secondary": p.secondary,
    "--ambient-deep": p.deep,
  } as CSSProperties;
  return (
    <div aria-hidden className="ambient-space" style={style}>
      {[1, 2].map((n) => (
        <div key={n} className={`ambient-sky ambient-sky-${n}`}>
          <div className="ambient-sky-paint" />
        </div>
      ))}
    </div>
  );
}
