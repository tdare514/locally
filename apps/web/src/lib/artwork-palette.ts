/**
 * Pure colour extraction for the release edit screen's artwork backdrop
 * (issue #112): it picks the cover's dominant colours and tones them into
 * three dark backdrop colours. White text sits on top of that backdrop, so every
 * colour is capped on WCAG relative luminance (a bright yellow cover would
 * otherwise make the text unreadable). No DOM and no node imports, so it is
 * safe to import client-side; the caller downscales the image and hands over
 * the RGBA bytes from `getImageData()`.
 */

/** Three backdrop colours as "#rrggbb", all dark enough for white text. */
export interface AmbientPalette {
  primary: string;
  secondary: string;
  deep: string;
}

/** Used when no artwork is available or its colours can't be read. */
export const NEUTRAL_PALETTE: AmbientPalette = {
  primary: "#262626",
  secondary: "#1a1a1a",
  deep: "#0d0d0d",
};

/** Hue in degrees (0..360), saturation and lightness in 0..1. */
interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Pixels that fell in the same quantised colour, kept as running sums so the
 * average colour can be taken afterwards. */
interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

const MIN_ALPHA = 125;
const MAX_SATURATION = 0.62;
const DEEP_MAX_SATURATION = 0.5;
const DEEP_LIGHTNESS = 0.1;
const LIGHTNESS_FLOOR = 0.14;
const MIN_HUE_GAP = 35;
const MIN_SECONDARY_SATURATION = 0.15;

/** Luminance caps: white on a 0.12 colour has contrast >= 6. */
const PRIMARY_CAP = 0.12;
const SECONDARY_CAP = 0.08;
const FALLBACK_SECONDARY_CAP = 0.06;
const DEEP_CAP = 0.035;

/** Parses "#rrggbb" into its three 0..255 channels. */
function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** The highlight's tint: the palette colour lifted to at least this HSB brightness, as the iPhone does (#362, #413). */
export const HIGHLIGHT_MIN_BRIGHTNESS = 0.85;

/** `hex` ("#rrggbb") with its HSB brightness raised to at least `min` (hue and saturation kept); the input when it is already brighter or not parseable. */
export function liftBrightness(hex: string, min = HIGHLIGHT_MIN_BRIGHTNESS): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const rgb = channels(hex);
  const v = Math.max(...rgb) / 255;
  if (v >= min) return hex;
  // Black has no hue to keep, so there is nothing to scale.
  if (v === 0) return hex;
  const scale = min / v;
  return `#${rgb
    .map((c) => Math.min(255, Math.round(c * scale)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG 2.x relative luminance of a "#rrggbb" colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21, whichever argument is lighter. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Circular distance between two hues, 0..180 degrees. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Lowers lightness in 0.01 steps until the colour's luminance is within `cap`.
 * Lightness is also lifted to `wantedFloor` (so black reads as a visible dark
 * grey) unless that floor would itself break the cap. */
function toneDown(
  hsl: Hsl,
  cap: number,
  wantedFloor = LIGHTNESS_FLOOR,
): string {
  const floor =
    relativeLuminance(hslToHex({ ...hsl, l: wantedFloor })) <= cap
      ? wantedFloor
      : 0;
  let l = Math.max(hsl.l, floor);
  let hex = hslToHex({ ...hsl, l });
  while (l > floor && relativeLuminance(hex) > cap) {
    l = Math.max(floor, l - 0.01);
    hex = hslToHex({ ...hsl, l });
  }
  return hex;
}

/** Picks a backdrop palette from RGBA bytes (a multiple of 4, as from
 * `getImageData().data`), or null when every pixel is mostly transparent. */
export function paletteFromPixels(
  data: ArrayLike<number>,
): AmbientPalette | null {
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) return null;

  // Near-black and near-white buckets are down-weighted so a plain background
  // rarely beats the artwork's real colours.
  const scored = [...buckets.values()].map((bucket) => {
    const hsl = rgbToHsl(
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    );
    const weight = hsl.l < 0.08 || hsl.l > 0.92 ? 0.15 : 1;
    return { hsl, score: bucket.count * (0.35 + hsl.s) * weight };
  });
  const best = (items: typeof scored) =>
    items.reduce((a, b) => (b.score > a.score ? b : a));

  const primary = best(scored).hsl;
  const others = scored.filter(
    ({ hsl }) =>
      hsl.s >= MIN_SECONDARY_SATURATION &&
      hueGap(hsl.h, primary.h) >= MIN_HUE_GAP,
  );
  const secondary = others.length > 0 ? best(others).hsl : null;

  const soften = (hsl: Hsl): Hsl => ({
    ...hsl,
    s: Math.min(hsl.s, MAX_SATURATION),
  });
  return {
    primary: toneDown(soften(primary), PRIMARY_CAP),
    secondary: secondary
      ? toneDown(soften(secondary), SECONDARY_CAP)
      : toneDown(soften(primary), FALLBACK_SECONDARY_CAP),
    deep: toneDown(
      {
        h: primary.h,
        s: Math.min(primary.s, DEEP_MAX_SATURATION),
        l: DEEP_LIGHTNESS,
      },
      DEEP_CAP,
      0,
    ),
  };
}
