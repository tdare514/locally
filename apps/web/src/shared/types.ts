/**
 * Shared contract between the API (server) and the UI (client).
 * Both sides import from here. Do not duplicate these shapes elsewhere.
 */

export type ReleaseKind = "single" | "album";

export interface Track {
  id: string;            // uuid
  title: string;
  trackNumber: number;   // 1-based position in the whole release, never restarts per disc
  discNumber?: number;   // 1-99; absent on a single-disc release
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

/**
 * Default sync service base URL, used before the user has ever set one: the
 * deployed sync API (issue #3). Point Settings at `http://localhost:4000`
 * to develop against a local `apps/api`; only https and loopback pass
 * validation (issue #11).
 */
export const DEFAULT_SYNC_BASE_URL = "https://locally-sync-api.vercel.app";

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
  spotifySourceDismissed?: boolean;  // user clicked "Done, I added it" on the Spotify source prompt
  trackPlays?: boolean;  // opt-in: count plays of Locally tracks in Spotify on this Mac (#106); default false
  playsPromptAnswered?: boolean;  // user answered the one-time "Count your Spotify plays?" card, either button (#110)
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
  trackPlays: boolean;
  playsPromptAnswered: boolean;
}

/** Response shape for GET /api/plays/status. */
export type PlaysStatus = "off" | "on" | "spotify-not-running" | "permission-denied";

export interface PlaysStatusResponse {
  status: PlaysStatus;
}

/** One device's count for a track in GET /api/plays. `current` marks this Mac. The release page
 * shows only the track's `total`; the devices are kept for the merge (#107). */
export interface TrackPlaysDevice {
  name: string;
  platform: string;
  count: number;
  current: boolean;
}

export interface TrackPlays {
  trackId: string;
  /** Sum over `devices`. Only tracks with at least one play are listed. */
  total: number;
  devices: TrackPlaysDevice[];
}

/** Response shape for GET /api/plays?releaseId=: the merged view of this Mac and the sync service. */
export interface ReleasePlaysResponse {
  tracks: TrackPlays[];
}

/** Where a pending release's files stand (#172). Absent means they are on the server: Send works.
 * "arriving" is the quiet "still uploading"; "waiting" means a later check still finds them missing. */
export type PendingFilesState = "arriving" | "waiting";

/** One track's plays inside the requested range, in GET /api/plays/summary (#200). `lastPlayedDay` is the latest day in the range with a play, `YYYY-MM-DD` in the Mac's local zone. */
export interface PlaysSummaryTrack {
  trackId: string;
  releaseId: string;
  plays: number;
  lastPlayedDay: string;
}

/** One track's all-time plays on this Mac, in GET /api/plays/summary (#200). */
export interface PlaysSummaryAllTime {
  trackId: string;
  releaseId: string;
  plays: number;
}

/** Response shape for GET /api/plays/summary?from=YYYY-MM-DD&to=YYYY-MM-DD: this Mac's plays, live releases only (#200). */
export interface PlaysSummaryResponse {
  tracks: PlaysSummaryTrack[];
  allTime: PlaysSummaryAllTime[];
  /** The earliest day bucket (`YYYY-MM-DD`, the Mac's local date) among live releases' tracks: when day counting began on this Mac, as far as the kept days show. null when no day is recorded (#145). */
  countingSince: string | null;
}

/** One release from another device (the phone, the web) that hasn't been imported into the local library yet. */
export interface PendingFromPhone {
  id: string;
  /** The record's `origin` token: "ios", "web" or any other a newer client writes (#185). */
  origin: string;
  title: string;
  artist: string;
  kind: ReleaseKind;
  trackCount: number;
  /** Set only while the files-missing check lists this release; an older service never sets it. */
  filesState?: PendingFilesState;
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
  tracks: { title: string; trackNumber: number; discNumber?: number }[];
}

/** Body of PATCH /api/releases/[id]. All fields optional; tracks are matched by id. */
export interface UpdateReleaseMeta {
  title?: string;
  artist?: string;
  year?: string | null;
  genre?: string | null;
  tracks?: { id: string; title?: string; trackNumber?: number; discNumber?: number }[];
}

/** Response shape for GET /api/spotify/source and POST /api/spotify/source/dismiss. */
export interface SpotifySourceStatus {
  libraryDir: string;
  watching: boolean;
  dismissed: boolean;
}

export interface ApiError { error: string }

export const SUPPORTED_AUDIO_EXT = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".aiff", ".aif"] as const;
export const SUPPORTED_IMAGE_EXT = [".jpg", ".jpeg", ".png"] as const;
