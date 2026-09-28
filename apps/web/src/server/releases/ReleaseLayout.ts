import path from "node:path";
import { ValidationError } from "../../shared/errors";

/** Longest sanitised segment; keeps "NN - title.mp3" comfortably under common filename limits. */
export const MAX_SEGMENT_LENGTH = 200;

/** Longest file name `assertPlainFileName` accepts: the limit on every common filesystem. */
export const MAX_FILE_NAME_LENGTH = 255;

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
   * troublesome across common filesystems, trims whitespace/dots, caps the
   * length, and falls back to "Unknown" if the result is empty.
   */
  sanitizeSegment(segment: string | null | undefined): string {
    const raw = (segment ?? "").toString();
    // Control characters (U+0000–U+001F, U+007F) are never part of a real name, and
    // NUL/newline are significant to the OS or a terminal. A loop rather than a
    // regex: eslint's no-control-regex flags the escapes.
    const printable = Array.from(raw)
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return c >= 0x20 && c !== 0x7f;
      })
      .join("");
    const stripped = printable.replace(/[/\\:*?"<>|]/g, "").trim();
    // No leading dots: ".foo" is a hidden folder and ".."/"..foo" look like traversal.
    // No trailing dots/spaces: problematic on Windows, harmless elsewhere.
    const cleaned = stripped.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
    // Cap by code point (never split a surrogate pair), then re-trim the end in case
    // the cut landed on a space or dot.
    const capped = Array.from(cleaned).slice(0, MAX_SEGMENT_LENGTH).join("").replace(/[.\s]+$/, "");
    return capped.length > 0 ? capped : "Unknown";
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

  /**
   * Accept a file name that arrived from outside the app (the sync service's
   * `tracks[].file` / `cover`) only if, joined to any directory, it can name
   * nothing but a direct child of that directory: no separators, not `.` or
   * `..` or any other leading-dot name, no control characters, and within the
   * filesystem length limit. Unlike `sanitizeSegment` this never rewrites -
   * the name has to match a file that already exists on disk, so a name that
   * isn't already plain is rejected rather than repaired. Returns it unchanged.
   */
  assertPlainFileName(name: string): string {
    const printable = Array.from(name).every((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x20 && c !== 0x7f;
    });
    const plain =
      name.length > 0 &&
      name.length <= MAX_FILE_NAME_LENGTH &&
      name === path.basename(name) &&
      !/[/\\]/.test(name) &&
      !name.startsWith(".") &&
      printable;
    if (!plain) {
      throw new ValidationError("File name must be a plain file name");
    }
    return name;
  }

  private pad2(n: number): string {
    // `n` reaches here from import meta and sync records. Anything but a small
    // non-negative integer (a string, a fraction, NaN) would be stringified into
    // a file name that isn't a plain number and could escape the release folder.
    if (!Number.isInteger(n) || n < 0 || n > 999) {
      throw new ValidationError("Track number must be an integer between 0 and 999");
    }
    return n < 10 ? `0${n}` : `${n}`;
  }
}
