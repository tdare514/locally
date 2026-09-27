export interface WriteTagsInput {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year?: string | null;
  genre?: string | null;
  trackNumber: number;
  trackTotal: number;
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
