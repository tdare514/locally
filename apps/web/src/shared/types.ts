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

/** Default sync service base URL, used before the user has ever set one. */
export const DEFAULT_SYNC_BASE_URL = "http://localhost:4000";

/**
 * Persisted sync configuration. `deviceToken` is a secret: it lives only in
 * `Settings` as read/written by the server-side `SettingsStore`, and is never
 * sent to the browser (see `SettingsResponse`/`SyncStatusSummary` below).
 */
export interface SyncSettings {
  baseUrl: string;
  deviceToken: string | null;
  email: string | null;
  lastVersion: number;
}

export interface Settings {
  libraryDir: string;    // where tagged files are written; Spotify should be pointed at this folder
  sync: SyncSettings | null;
}

/** The `sync` field as returned to the browser by GET/PUT /api/settings: no token. */
export interface SyncStatusSummary {
  baseUrl: string;
  email: string | null;
  signedIn: boolean;
  lastVersion: number;
}

/** Shape actually returned by GET/PUT /api/settings (never carries the device token). */
export interface SettingsResponse {
  libraryDir: string;
  sync: SyncStatusSummary;
}

/** One release from the phone that hasn't been imported into the local library yet. */
export interface PendingFromPhone {
  id: string;
  title: string;
  artist: string;
  kind: ReleaseKind;
  trackCount: number;
}

export interface SyncQuota {
  usedBytes: number;
  limitBytes: number;
}

/** Response shape for GET /api/sync/status. */
export interface SyncStatus {
  signedIn: boolean;
  email: string | null;
  baseUrl: string;
  deviceName: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  pendingFromPhone: PendingFromPhone[];
  quota: SyncQuota | null;
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
