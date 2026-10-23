/**
 * Shared contract between the API (server) and the UI (client).
 * Both sides import from here. Do not duplicate these shapes elsewhere.
 */
import type { FriendShare, ShareGroup } from "./shares";

export type ReleaseKind = "single" | "album";

export interface Track {
  id: string;            // uuid
  title: string;
  trackNumber: number;   // 1-based position in the whole release, never restarts per disc
  discNumber?: number;   // 1-99; absent on a single-disc release
  filePath: string;      // absolute path of the tagged .mp3 inside the library folder
  originalName: string;  // filename the user uploaded
  durationSec: number | null;
  /** Adopted tracks only (#245): the `spotify:local:` id Spotify builds from the file's tags. */
  localId?: string;
  /** Adopted tracks only: the file was gone at the last scan. Shown, never deleted. */
  missing?: boolean;
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
  /** True for a release adopted in place (#245): its files stay where they are and are never written. */
  adopted?: boolean;
  /** Adopted releases only: the scanner's group key, so adopting the same group again adds nothing. */
  adoptKey?: string;
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

/**
 * The Spotify connection (#239). Secrets: like `SyncSettings.deviceToken`, this lives only in
 * the server-side settings file and is never sent to the browser or the sync API.
 */
export interface SpotifySettings {
  accessToken: string;
  accessTokenExpiresAt: number;  // epoch ms
  refreshToken: string;
  revision: string;  // random id per connect; a refresh only writes to the connection it started from
  scopes: string[];
  userId: string;
  displayName: string;
  connectedAt: string;  // ISO timestamp
}

/** Response shape for GET /api/spotify/playlists?releaseId=: the playlists each track is in (#212). */
export interface SpotifyPlaylistsResponse {
  connected: boolean;
  tracks: Record<string, { id: string; name: string }[]>;
  /** A background refresh is running; the answer is from the cache. */
  refreshing?: boolean;
  /** Set while a refresh is held off: seconds until it may start again. */
  retryAfterSec?: number;
}

/** Response shape for GET/DELETE /api/spotify/connection: no tokens. */
export interface SpotifyConnectionStatus {
  available: boolean;
  connected: boolean;
  displayName: string | null;
  scopes: string[];
  pending: boolean;
  error: string | null;
}

export interface Settings {
  libraryDir: string;    // where tagged files are written; Spotify should be pointed at this folder
  sync: SyncSettings | null;
  spotifySourceDismissed?: boolean;  // user clicked "Done, I added it" on the Spotify source prompt
  trackPlays?: boolean;  // opt-in: count plays of Locally tracks in Spotify on this Mac (#106); default false
  countOtherDevices?: boolean;  // opt-in: count plays on the user's other devices through the Spotify account (#228); default false
  spotify?: SpotifySettings;  // the Spotify connection (#239); absent when disconnected
  playsPromptAnswered?: boolean;  // user answered the one-time "Count your Spotify plays?" card, either button (#110)
  adoptRoots?: string[];  // folders Spotify reads that Locally scans to adopt in place (#245); read as [] when absent
  shareGroups?: ShareGroup[];  // saved lists of recipient emails for sharing (#182); client-side only, never sent to the service
  installId?: string;  // random UUID made once on this Mac, sent with sync sign-in (#210); never logged, never sent to the browser
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
  countOtherDevices: boolean;
  playsPromptAnswered: boolean;
  /** The Spotify folders Locally reads to add releases in place (#249). */
  adoptRoots: string[];
  /** `~/Documents/Spotify Music` when it exists and is not already a Spotify folder, else null. */
  suggestedAdoptRoot: string | null;
}

/** Response shape for GET /api/plays/status. */
export type PlaysStatus = "off" | "on" | "spotify-not-running" | "permission-denied";

export interface PlaysStatusResponse {
  status: PlaysStatus;
  /** Where plays are read from: the Spotify account (every device), this Mac's Spotify app only (#228), or the sync service counting online, which leaves this Mac out (#307). */
  source: "account" | "this-mac" | "online";
  /** True while the account source failed and this Mac's app is read instead. */
  fallingBack: boolean;
}

/** Why online play counting is not running right now, as the sync service reports it (#307). */
export type CloudPlaysProblem = "reconnect" | "notOnTesterList" | "rateLimited";

/** Response shape for GET /api/spotify/cloud: the sync service counting plays while the Mac is off (#307). */
export interface CloudPlaysStatus {
  /** Signed in to sync and the service has the feature. False hides the Settings row. */
  available: boolean;
  linked: boolean;
  lastSampleAt: string | null;
  problem: CloudPlaysProblem | null;
  /** The owner was sent to the browser and the link has not come back yet. */
  pending: boolean;
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
  /** True when the sync service's summary was merged in, so the plays include other devices (#202). `countingSince` stays this Mac's. */
  includesOtherDevices: boolean;
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
  /** Which server version of the record this is, so a Hide on this Mac holds for it only (#295). */
  hideKey?: string;
  /** When the record was last written (ISO), for the "since 27 Sep" on a waiting row. */
  sentAt?: string;
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
  /** releaseId -> the `hideKey` hidden from the tray on this Mac (#295). */
  hiddenFromTray?: Record<string, string>;
  /** Shares sent to this account that it has not claimed, for the tray's "From your friends" section (#182). */
  fromFriends?: FriendShare[];
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
  /** `discNumber: null` clears the disc (back to a release with no discs); absent leaves it as it is. */
  tracks?: { id: string; title?: string; trackNumber?: number; discNumber?: number | null }[];
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
