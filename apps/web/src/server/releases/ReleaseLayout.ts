import path from "node:path";
import { ValidationError } from "../../shared/errors";

/** Longest sanitised segment; keeps "NN - title.mp3" comfortably under common filename limits. */
export const MAX_SEGMENT_LENGTH = 200;

/** Longest file name `assertPlainFileName` accepts: the limit on every common filesystem. */
export const MAX_FILE_NAME_LENGTH = 255;

/**
 * Bytes reserved out of `MAX_FILE_NAME_LENGTH` when byte-capping a sanitised segment, so
 * there's room left for whatever a caller appends afterwards: a `.mp3`/".jpg" extension,
 * or `uniqueDir`'s " (n)" suffix.
 */
const RESERVED_SUFFIX_BYTES = 16;

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
    // NUL/newline are significant to the OS or a terminal. Zero-width and bidi control
    // characters (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF, U+061C) are
    // invisible but can reorder or hide the rest of a rendered name (e.g. disguise an
    // extension), so they're stripped too. A loop rather than a regex: eslint's
    // no-control-regex flags the escapes, and this keeps both checks in one pass.
    const printable = Array.from(raw)
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        if (c >= 0x20 && c !== 0x7f) {
          if (c === 0x061c) return false;
          if (c >= 0x200b && c <= 0x200f) return false;
          if (c >= 0x202a && c <= 0x202e) return false;
          if (c >= 0x2066 && c <= 0x2069) return false;
          if (c === 0xfeff) return false;
          return true;
        }
        return false;
      })
      .join("");
    const stripped = printable.replace(/[/\\:*?"<>|]/g, "").trim();
    // No leading dots: ".foo" is a hidden folder and ".."/"..foo" look like traversal.
    // No trailing dots/spaces: problematic on Windows, harmless elsewhere.
    const cleaned = stripped.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
    // Cap by code point (never split a surrogate pair) AND by UTF-8 byte length, since a
    // multibyte-heavy name (emoji, CJK) can blow past the filesystem's byte limit long
    // before it hits the code-point cap. `RESERVED_SUFFIX_BYTES` leaves room for whatever
    // the caller appends afterwards (an extension, or uniqueDir's " (n)").
    const capped = this.capToByteLength(
      Array.from(cleaned).slice(0, MAX_SEGMENT_LENGTH).join(""),
      MAX_FILE_NAME_LENGTH - RESERVED_SUFFIX_BYTES
    ).replace(/[.\s]+$/, "");
    return capped.length > 0 ? capped : "Unknown";
  }

  /** Truncate `value` to at most `maxBytes` of UTF-8, cutting only on a code-point boundary. */
  private capToByteLength(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, "utf-8") <= maxBytes) return value;
    const chars = Array.from(value);
    let bytes = 0;
    let end = 0;
    for (; end < chars.length; end++) {
      bytes += Buffer.byteLength(chars[end], "utf-8");
      if (bytes > maxBytes) break;
    }
    return chars.slice(0, end).join("");
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
