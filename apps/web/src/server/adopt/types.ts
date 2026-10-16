/** One audio file in a proposed release (#245). Read only; Locally never writes the file. */
export interface ProposedTrack {
  path: string;
  title: string;
  trackNumber: number;
  discNumber?: number;
  durationSec: number;
  /** The `spotify:local:artist:album:title:seconds` id Spotify builds from the file's tags. */
  localId: string;
}

/** A release the scanner suggests adopting: one folder, one album artist and album, or one single. */
export interface ProposedGroup {
  /** Stable across rescans: a hash of the folder and the grouping key. */
  key: string;
  folder: string;
  kind: "album" | "single";
  title: string;
  artist: string;
  year: string | null;
  genre: string | null;
  /** Path of the first file with embedded art, or null. Nothing is extracted by the scanner. */
  coverFrom: string | null;
  tracks: ProposedTrack[];
}

export interface AdoptProposal {
  scannedAt: string;
  roots: string[];
  groups: ProposedGroup[];
  /** Files not adopted, counted by lower-case extension (".flac"). */
  skipped: Record<string, number>;
}
