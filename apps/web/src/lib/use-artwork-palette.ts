"use client";

import { useEffect, useState } from "react";
import { paletteFromPixels, type AmbientPalette } from "./artwork-palette";

/** The cover is drawn this small before sampling: plenty for a dominant colour, and cheap. */
const SAMPLE_SIDE = 24;

/** Palettes already read, the oldest dropped first past 64 (#422): scrolling the library changes the wash's cover many times a
 * second and comes back to the same covers. A cover's URL carries its `updatedAt`, so a new cover is a new key. */
const PALETTE_CACHE_MAX = 64;
const paletteCache = new Map<string, AmbientPalette>();

/** Reads the backdrop palette off an image. Same-origin URLs only (the local cover route or
 * an object URL); a cross-origin image would taint the canvas and `getImageData` would throw.
 * `superseded` is asked once the image has decoded: a read nobody wants any more stops before the canvas work. */
async function readPalette(url: string, superseded: () => boolean): Promise<AmbientPalette | null> {
  const cached = paletteCache.get(url);
  if (cached) return cached;
  const img = new Image();
  img.src = url;
  await img.decode();
  if (superseded()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIDE;
  canvas.height = SAMPLE_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  const palette = paletteFromPixels(ctx.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data);
  if (palette && !url.startsWith("blob:")) {
    paletteCache.set(url, palette);
    const oldest = paletteCache.keys().next().value;
    if (paletteCache.size > PALETTE_CACHE_MAX && oldest !== undefined) paletteCache.delete(oldest);
  }
  return palette;
}

/** The palette for the cover at `url`, or null when there is no cover. While a new cover is
 * being read the previous palette stays, so the backdrop fades from old to new rather than
 * through grey. */
export function useArtworkPalette(url: string | null): AmbientPalette | null {
  const [palette, setPalette] = useState<AmbientPalette | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    readPalette(url, () => cancelled)
      .then((p) => {
        if (!cancelled && p) setPalette(p);
      })
      .catch(() => {
        // An undecodable cover keeps the current backdrop; the cover itself shows the problem.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return url ? palette : null;
}
