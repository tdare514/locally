import type { Rect } from "./crop-geometry";

export interface CropImageOptions {
  /** The output's longest side is scaled down to this many pixels if needed. Never scaled up. */
  maxSide?: number;
}

const DEFAULT_MAX_SIDE = 1500;
const JPEG_QUALITY = 0.9;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Crops `file` to the image-space `rect`, downscaling so neither side exceeds `maxSide` (default
 * 1500), and re-encodes it as JPEG (quality 0.9) unless the source is a PNG that actually uses
 * transparency, in which case the crop is kept as PNG. EXIF orientation is respected, matching
 * `apps/ios/Locally/Domain/ImageCropper.swift`'s output contract. */
export async function cropImage(
  file: File,
  rect: Rect,
  options: CropImageOptions = {},
): Promise<File> {
  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  let canvas: HTMLCanvasElement;
  try {
    const longestSide = Math.max(rect.width, rect.height);
    const scale = longestSide > maxSide ? maxSide / longestSide : 1;
    const outputWidth = Math.max(1, Math.round(rect.width * scale));
    const outputHeight = Math.max(1, Math.round(rect.height * scale));

    canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context is unavailable");

    ctx.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    const keepPng =
      (await looksLikePng(file)) &&
      canvasHasTransparency(ctx, outputWidth, outputHeight);
    const mimeType = keepPng ? "image/png" : "image/jpeg";
    const blob = await encodeCanvas(
      canvas,
      mimeType,
      keepPng ? undefined : JPEG_QUALITY,
    );
    const name = deriveFileName(file.name, keepPng ? "png" : "jpg");
    return new File([blob], name, { type: mimeType, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number | undefined,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode cropped image"));
      },
      mimeType,
      quality,
    );
  });
}

/** Cheap format sniff off the file's magic bytes, independent of the (sometimes unreliable)
 * `File.type` reported by the browser or OS file picker. */
async function looksLikePng(file: File): Promise<boolean> {
  const header = new Uint8Array(
    await file.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
  );
  if (header.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, i) => header[i] === byte);
}

/** Scans the drawn crop for any non-opaque pixel. Reading back off the destination canvas (rather
 * than re-decoding the source) means this reflects exactly what will be encoded. */
function canvasHasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  if (width <= 0 || height <= 0) return false;
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function deriveFileName(originalName: string, ext: "jpg" | "png"): string {
  const dot = originalName.lastIndexOf(".");
  const base =
    (dot > 0 ? originalName.slice(0, dot) : originalName).trim() || "cover";
  return `${base}.${ext}`;
}
