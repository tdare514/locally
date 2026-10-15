export interface WriteTagsInput {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year?: string | null;
  genre?: string | null;
  /** The number for the file's track tag (TRCK): the position within its disc when discs are set,
   * else the release-wide `trackNumber`. Derive it with `deriveTagNumbers`. */
  trackNumber: number;
  trackTotal: number;
  /** TPOS `discNumber/discTotal`. Written only when both are set; leave both out for no disc tag. */
  discNumber?: number | null;
  discTotal?: number | null;
  coverPath?: string | null;
}

export interface ReadTagsResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  durationSec: number | null;
  hasCover: boolean;
  /** The file's own track tag (TRCK/trkn), used to order an import. */
  trackNumber?: number | null;
  trackTotal?: number | null;
  /** The file's disc tag (TPOS/disk). Null when absent or outside 1 to 99. */
  discNumber?: number | null;
  discTotal?: number | null;
}

/**
 * Reads and writes ID3v2 metadata on media files. Behind an interface so
 * `ReleaseService`/`InspectService` tests can record calls instead of
 * depending on real tag libraries and real files.
 */
export interface TagService {
  /** Write ID3v2 tags (including cover art, if provided) into an mp3 file at filePath. */
  write(filePath: string, input: WriteTagsInput): Promise<void>;
  /** Read existing tags from a media file (any format the impl supports). */
  read(filePath: string): Promise<ReadTagsResult>;
}
