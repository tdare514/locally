"use client";

import { useEffect, useState } from "react";
import { paletteFromPixels, type AmbientPalette } from "./artwork-palette";

/** The cover is drawn this small before sampling: plenty for a dominant colour, and cheap. */
const SAMPLE_SIDE = 24;

/** Reads the backdrop palette off an image. Same-origin URLs only (the local cover route or
 * an object URL); a cross-origin image would taint the canvas and `getImageData` would throw. */
async function readPalette(url: string): Promise<AmbientPalette | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIDE;
  canvas.height = SAMPLE_SIDE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  return paletteFromPixels(ctx.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data);
}

/** The palette for the cover at `url`, or null when there is no cover. While a new cover is
 * being read the previous palette stays, so the backdrop fades from old to new rather than
 * through grey. */
export function useArtworkPalette(url: string | null): AmbientPalette | null {
  const [palette, setPalette] = useState<AmbientPalette | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    readPalette(url)
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
