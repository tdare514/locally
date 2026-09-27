/** Input limits and content sniffing shared by the upload routes. */

export const MAX_COVER_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

/** Detect JPEG/PNG from the leading bytes rather than trusting the filename. */
export async function sniffImageMime(file: File): Promise<"image/jpeg" | "image/png" | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}
