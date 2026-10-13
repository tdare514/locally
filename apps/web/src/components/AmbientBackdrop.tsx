"use client";

import type { CSSProperties } from "react";
import { NEUTRAL_PALETTE, type AmbientPalette } from "../lib/artwork-palette";

/** The release page's colour wash, taken from the cover (#112). It is positioned against the
 * main pane (which is `relative isolate`), so it spans the whole pane, not just the 920 column.
 * The colours are registered custom properties, so a new cover cross-fades the wash. */
export default function AmbientBackdrop({ palette }: { palette: AmbientPalette | null }) {
  const p = palette ?? NEUTRAL_PALETTE;
  const style = {
    "--ambient-primary": p.primary,
    "--ambient-secondary": p.secondary,
    "--ambient-deep": p.deep,
  } as CSSProperties;
  return <div aria-hidden className="ambient-backdrop" style={style} />;
}
