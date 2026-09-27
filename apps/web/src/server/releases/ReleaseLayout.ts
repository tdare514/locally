import path from "node:path";

/**
 * Pure, I/O-free rules for turning release metadata into filesystem paths.
 * Kept separate from `ReleaseService` so the naming/sanitisation rules can be
 * unit tested without touching disk, and so every user-derived path in the
 * app goes through one reviewable place.
 */
export class ReleaseLayout {
  /**
   * Sanitize a single path segment (artist/album/track name) for safe use as
   * a file or directory name. Strips characters that are illegal or
   * troublesome across common filesystems, trims whitespace/dots, and falls
   * back to "Unknown" if the result is empty.
   */
  sanitizeSegment(segment: string | null | undefined): string {
    const raw = (segment ?? "").toString();
    const stripped = raw.replace(/[/\\:*?"<>|]/g, "").trim();
    // Remove trailing dots/spaces (problematic on Windows, harmless elsewhere).
    const cleaned = stripped.replace(/[.\s]+$/g, "").trim();
    return cleaned.length > 0 ? cleaned : "Unknown";
  }

  /** The (not-yet-deduplicated) folder for a release, given its artist/album. */
  folderFor(libraryDir: string, artist: string, album: string): string {
    return path.join(libraryDir, this.sanitizeSegment(artist), this.sanitizeSegment(album));
  }

  /** Zero-padded, sanitised track filename, e.g. `"03 - Title.mp3"`. */
  trackFileName(trackNumber: number, title: string): string {
    return `${this.pad2(trackNumber)} - ${this.sanitizeSegment(title)}.mp3`;
  }

  /** Cover filename for a given mime type or type string (defaults to jpg). */
  coverFileName(mimeOrName: string): string {
    const lower = mimeOrName.toLowerCase();
    if (lower.includes("png")) return "cover.png";
    return "cover.jpg";
  }

  private pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
  }
}
