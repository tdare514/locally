/**
 * Pure geometry for the cover crop UI: everything here works in image space
 * (pixels of the source image, not the screen), so it has no DOM dependency
 * and mirrors `apps/ios/Locally/Domain/ImageCropper.swift` exactly so both
 * apps frame a cover the same way. Keep this file's semantics in lockstep
 * with that one; `tests/unit/crop-geometry.test.ts` mirrors its test cases.
 */

/** The aspect ratio offered when framing a cover image. Spotify always shows
 * local-file artwork as a square, so `"square"` is the default; `"original"`
 * is offered for users who want the untouched image. */
export type CoverRatio = "square" | "original";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A crop rect in image space. Unlike `CGRect`, there's no separate origin/size
 * type in the DOM, so this flattens both into one shape. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pan translation in image space (image-space dx/dy, not screen pixels). */
export interface Delta {
  dx: number;
  dy: number;
}

/** A crop rect is never allowed to shrink below this fraction of the image's
 * shorter side, so zooming in can't collapse it to nothing. */
const MIN_SIDE_FRACTION = 0.1;

/** The largest centred rect of `ratio`'s aspect that fits inside `imageSize`.
 * For `"square"` that's a centred square sized to the image's shorter side;
 * for `"original"` it's the whole image. */
export function initialRect(imageSize: Size, ratio: CoverRatio): Rect {
  if (ratio === "original") {
    return { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
  }
  const side = Math.min(imageSize.width, imageSize.height);
  return {
    x: (imageSize.width - side) / 2,
    y: (imageSize.height - side) / 2,
    width: side,
    height: side,
  };
}

/** Keeps `rect` fully inside `imageSize`. If `rect` is larger than the image
 * in either dimension it is shrunk first, preserving its aspect ratio, then
 * repositioned so every edge lies within bounds. */
export function clamp(rect: Rect, imageSize: Size): Rect {
  if (
    imageSize.width <= 0 ||
    imageSize.height <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
  }

  let width = rect.width;
  let height = rect.height;
  if (width > imageSize.width || height > imageSize.height) {
    const shrink = Math.min(imageSize.width / width, imageSize.height / height);
    width *= shrink;
    height *= shrink;
  }

  const x = Math.max(0, Math.min(rect.x, imageSize.width - width));
  const y = Math.max(0, Math.min(rect.y, imageSize.height - height));
  return { x, y, width, height };
}

function minSide(imageSize: Size): number {
  return Math.min(imageSize.width, imageSize.height) * MIN_SIDE_FRACTION;
}

function aspectRatioFor(
  ratio: CoverRatio,
  imageSize: Size,
  fallback: number,
): number {
  if (ratio === "square") return 1;
  if (imageSize.height <= 0) return fallback;
  return imageSize.width / imageSize.height;
}

/** Zooms `rect` by `scale` about the image-space `point`, keeping `point` at
 * the same relative offset within the new rect. `scale` > 1 zooms in (the
 * rect shrinks, showing a more magnified crop); `scale` < 1 zooms out. The
 * result never exceeds `imageSize` and never shrinks below `minSideFraction`
 * of its shorter side. */
export function zoomed(
  rect: Rect,
  scale: number,
  point: Point,
  ratio: CoverRatio,
  imageSize: Size,
): Rect {
  if (
    scale <= 0 ||
    imageSize.width <= 0 ||
    imageSize.height <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return rect;
  }

  const aspect = aspectRatioFor(ratio, imageSize, rect.width / rect.height);

  let newWidth = rect.width / scale;
  newWidth = Math.max(newWidth, minSide(imageSize));
  let newHeight = newWidth / aspect;

  if (newWidth > imageSize.width || newHeight > imageSize.height) {
    const cap = Math.min(
      imageSize.width / newWidth,
      imageSize.height / newHeight,
    );
    newWidth *= cap;
    newHeight *= cap;
  }

  const relX = (point.x - rect.x) / rect.width;
  const relY = (point.y - rect.y) / rect.height;
  const newOrigin = {
    x: point.x - relX * newWidth,
    y: point.y - relY * newHeight,
  };
  return clamp({ ...newOrigin, width: newWidth, height: newHeight }, imageSize);
}

/** Translates `rect` by `delta` (image space) and clamps it back inside
 * `imageSize`, so panning stops dead at the image's edges. */
export function panned(rect: Rect, delta: Delta, imageSize: Size): Rect {
  return clamp(
    {
      x: rect.x + delta.dx,
      y: rect.y + delta.dy,
      width: rect.width,
      height: rect.height,
    },
    imageSize,
  );
}
