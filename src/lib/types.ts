/**
 * Shared contract between the API (server) and the UI (client).
 * Both sides import from here. Do not duplicate these shapes elsewhere.
 */

export type ReleaseKind = "single" | "album";

export interface Track {
  id: string;            // uuid
  title: string;
  trackNumber: number;   // 1-based
  filePath: string;      // absolute path of the tagged .mp3 inside the library folder
  originalName: string;  // filename the user uploaded
  durationSec: number | null;
}

export interface Release {
  id: string;            // uuid
  kind: ReleaseKind;
  title: string;         // album title (for singles this equals the track title unless user overrides)
  artist: string;        // album artist / primary artist
  year: string | null;   // "2024"
  genre: string | null;
  coverPath: string | null; // absolute path to cover.jpg/png stored next to the tracks
  folderPath: string;    // absolute folder holding this release's files
  tracks: Track[];
  createdAt: string;     // ISO
  updatedAt: string;     // ISO
}

export interface Library {
  version: 1;
  releases: Release[];
}

export interface Settings {
  libraryDir: string;    // where tagged files are written; Spotify should be pointed at this folder
}

/** Metadata sent by the client when importing. Sent as a JSON string in the `meta` form field. */
export interface ImportMeta {
  kind: ReleaseKind;
  title: string;         // album title; for singles the client may leave it empty and server uses track title
  artist: string;
  year?: string;
  genre?: string;
  /** One entry per uploaded audio file, in the same order as the `audio` form files. */
  tracks: { title: string; trackNumber: number }[];
}

/** Body of PATCH /api/releases/[id]. All fields optional; tracks are matched by id. */
export interface UpdateReleaseMeta {
  title?: string;
  artist?: string;
  year?: string | null;
  genre?: string | null;
  tracks?: { id: string; title?: string; trackNumber?: number }[];
}

export interface ApiError { error: string }

export const SUPPORTED_AUDIO_EXT = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".aiff", ".aif"] as const;
export const SUPPORTED_IMAGE_EXT = [".jpg", ".jpeg", ".png"] as const;
