/**
 * Produces a 320kbps mp3 from an arbitrary audio file, because Spotify's
 * "Local Files" only reads mp3/mp4. Behind an interface so tests can fake
 * conversion (a plain file copy) instead of depending on a real ffmpeg binary.
 */
export interface AudioConverter {
  /** Convert (or copy, if already mp3) `inputPath` to an mp3 at `outputPath`. */
  toMp3(inputPath: string, outputPath: string): Promise<void>;
}
