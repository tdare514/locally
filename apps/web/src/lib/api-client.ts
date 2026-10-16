/**
 * Typed fetch wrappers for the Spotify Local Import API.
 * See PLAN.md "API" section for the contract; shapes come from ../shared/types.
 */
import type {
  SettingsResponse,
  Library,
  Release,
  ImportMeta,
  UpdateReleaseMeta,
  ApiError,
  SyncStatus,
  SpotifySourceStatus,
  PlaysStatusResponse,
  SpotifyConnectionStatus,
  SpotifyPlaylistsResponse,
  PlaysSummaryResponse,
  ReleasePlaysResponse,
} from "../shared/types";
import type { AdoptProposal } from "../server/adopt/types";
import type { AdoptBatchResponse } from "./adopt-review";

/** Response shape for POST /api/inspect (per-file prefill data). Not a persisted entity, so it
 * isn't declared in types.ts, but it mirrors the PLAN.md spec exactly. */
export interface InspectedFile {
  name: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  genre: string | null;
  durationSec: number | null;
  hasCover: boolean;
  /** The file's own track and disc tags, so the import can order a multi-disc album. */
  trackNumber?: number | null;
  discNumber?: number | null;
}

export interface InspectResponse {
  files: InspectedFile[];
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiError;
      if (body && typeof body.error === "string" && body.error) {
        message = body.error;
      }
    } catch {
      // ignore parse errors, fall back to generic message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function getSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", { signal });
  return handle<SettingsResponse>(res);
}

export async function putSettings(libraryDir: string): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryDir }),
  });
  return handle<SettingsResponse>(res);
}

/** Replaces the list of Spotify folders Locally reads (#249). The server checks each one. */
export async function putAdoptRoots(adoptRoots: string[]): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adoptRoots }),
  });
  return handle<SettingsResponse>(res);
}

/** The last check's findings, or null when there has not been one. */
export async function getAdoptProposal(signal?: AbortSignal): Promise<AdoptProposal | null> {
  const res = await fetch("/api/adopt/proposal", { signal });
  return (await handle<{ proposal: AdoptProposal | null }>(res)).proposal;
}

/** Reads the Spotify folders again (read only) and returns the new findings. Can take a minute. */
export async function scanAdopt(signal?: AbortSignal): Promise<AdoptProposal> {
  const res = await fetch("/api/adopt/scan", { method: "POST", signal });
  return handle<AdoptProposal>(res);
}

/** Adds the named groups of the stored findings to the library, in place. */
export async function adoptGroups(keys: string[]): Promise<AdoptBatchResponse> {
  const res = await fetch("/api/adopt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  return handle<AdoptBatchResponse>(res);
}

/** Removes an added release from Locally; its files are never touched. */
export async function forgetRelease(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/releases/${encodeURIComponent(id)}?forget=1`, { method: "DELETE" });
  return handle<{ ok: true }>(res);
}

export async function putTrackPlays(trackPlays: boolean): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trackPlays }),
  });
  return handle<SettingsResponse>(res);
}

export async function putCountOtherDevices(countOtherDevices: boolean): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ countOtherDevices }),
  });
  return handle<SettingsResponse>(res);
}

/** The one-time "Count your Spotify plays?" card (#110): both answers mark it answered; "Turn on" also
 * sets trackPlays, which runs the first check (and the macOS Automation prompt). */
export async function answerPlaysPrompt(turnOn: boolean): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnOn ? { trackPlays: true, playsPromptAnswered: true } : { playsPromptAnswered: true }),
  });
  return handle<SettingsResponse>(res);
}

export async function getPlaysStatus(): Promise<PlaysStatusResponse> {
  const res = await fetch("/api/plays/status");
  return handle<PlaysStatusResponse>(res);
}

/** Merged play counts for one release's tracks (#107). One request per release page open. */
export async function getReleasePlays(releaseId: string): Promise<ReleasePlaysResponse> {
  const res = await fetch(`/api/plays?releaseId=${encodeURIComponent(releaseId)}`);
  return handle<ReleasePlaysResponse>(res);
}

/** This Mac's plays between two local dates (`YYYY-MM-DD`, inclusive) and all time, for the
 * releases in the library, in one request (the sidebar widgets, #154, #203). */
export async function getPlaysSummary(from: string, to: string): Promise<PlaysSummaryResponse> {
  const res = await fetch(`/api/plays/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  return handle<PlaysSummaryResponse>(res);
}

export async function putSyncBaseUrl(baseUrl: string): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sync: { baseUrl } }),
  });
  return handle<SettingsResponse>(res);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const res = await fetch("/api/sync/status");
  return handle<SyncStatus>(res);
}

export async function requestSyncCode(email: string): Promise<{ ok: true }> {
  const res = await fetch("/api/sync/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handle<{ ok: true }>(res);
}

export async function verifySyncCode(email: string, code: string): Promise<SettingsResponse> {
  const res = await fetch("/api/sync/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  return handle<SettingsResponse>(res);
}

export async function signOutSync(): Promise<{ ok: true }> {
  const res = await fetch("/api/sync/signout", { method: "POST" });
  return handle<{ ok: true }>(res);
}

export async function deleteSyncAccount(): Promise<SettingsResponse & { alreadySignedOut?: boolean }> {
  const res = await fetch("/api/sync/account", { method: "DELETE" });
  return handle<SettingsResponse & { alreadySignedOut?: boolean }>(res);
}

export async function syncNow(): Promise<SyncStatus> {
  const res = await fetch("/api/sync/reconcile", { method: "POST" });
  return handle<SyncStatus>(res);
}

/** "Resync Mac and phone": `asked` is false when the request has to wait (rate limit) or the service lacks it. */
export async function resyncFromPhone(): Promise<{ ok: true; asked: boolean }> {
  const res = await fetch("/api/sync/resync", { method: "POST" });
  return handle<{ ok: true; asked: boolean }>(res);
}

export async function acceptFromPhone(id: string): Promise<{ ok: true; release: Release }> {
  const res = await fetch(`/api/sync/accept/${encodeURIComponent(id)}`, { method: "POST" });
  return handle<{ ok: true; release: Release }>(res);
}

export async function getLibrary(signal?: AbortSignal): Promise<Library> {
  const res = await fetch("/api/library", { signal });
  return handle<Library>(res);
}

export async function inspectFiles(audio: File[]): Promise<InspectResponse> {
  const form = new FormData();
  for (const file of audio) {
    form.append("audio", file);
  }
  const res = await fetch("/api/inspect", { method: "POST", body: form });
  return handle<InspectResponse>(res);
}

export async function importRelease(
  meta: ImportMeta,
  audio: File[],
  cover?: File | null
): Promise<Release> {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  if (cover) {
    form.append("cover", cover);
  }
  for (const file of audio) {
    form.append("audio", file);
  }
  const res = await fetch("/api/import", { method: "POST", body: form });
  return handle<Release>(res);
}

export async function getRelease(id: string): Promise<Release> {
  const res = await fetch(`/api/releases/${encodeURIComponent(id)}`);
  return handle<Release>(res);
}

export async function updateRelease(
  id: string,
  patch: UpdateReleaseMeta
): Promise<Release> {
  const res = await fetch(`/api/releases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handle<Release>(res);
}

export async function replaceCover(id: string, cover: File): Promise<Release> {
  const form = new FormData();
  form.append("cover", cover);
  const res = await fetch(`/api/releases/${encodeURIComponent(id)}/cover`, {
    method: "PUT",
    body: form,
  });
  return handle<Release>(res);
}

export async function deleteRelease(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/releases/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return handle<{ ok: true }>(res);
}

export async function getSpotifySource(): Promise<SpotifySourceStatus> {
  const res = await fetch("/api/spotify/source");
  return handle<SpotifySourceStatus>(res);
}

/** The Spotify connection, or null when this build doesn't offer it (the route answers 404). */
export async function getSpotifyConnection(): Promise<SpotifyConnectionStatus | null> {
  const res = await fetch("/api/spotify/connection");
  if (res.status === 404) return null;
  return handle<SpotifyConnectionStatus>(res);
}

/** The playlists each track of a release is in, or null when this build has no Spotify connection (404). */
export async function getSpotifyPlaylists(releaseId: string): Promise<SpotifyPlaylistsResponse | null> {
  const res = await fetch(`/api/spotify/playlists?releaseId=${encodeURIComponent(releaseId)}`);
  if (res.status === 404) return null;
  return handle<SpotifyPlaylistsResponse>(res);
}

/** Open one of the user's playlists in the Spotify app. */
export async function openSpotifyPlaylist(id: string): Promise<{ ok: true }> {
  const res = await fetch("/api/spotify/open-playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return handle<{ ok: true }>(res);
}

export async function startSpotifyAuth(): Promise<{ authorizeUrl: string }> {
  const res = await fetch("/api/spotify/auth/start", { method: "POST" });
  return handle<{ authorizeUrl: string }>(res);
}

/** Disconnect, or cancel a sign-in that is waiting. */
export async function disconnectSpotify(): Promise<SpotifyConnectionStatus> {
  const res = await fetch("/api/spotify/connection", { method: "DELETE" });
  return handle<SpotifyConnectionStatus>(res);
}

export async function dismissSpotifySource(): Promise<SpotifySourceStatus> {
  const res = await fetch("/api/spotify/source/dismiss", { method: "POST" });
  return handle<SpotifySourceStatus>(res);
}

export async function openSpotifySettings(): Promise<{ ok: true }> {
  const res = await fetch("/api/spotify/open", { method: "POST" });
  return handle<{ ok: true }>(res);
}

export async function reveal(path?: string): Promise<{ ok: true }> {
  const res = await fetch("/api/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(path ? { path } : {}),
  });
  return handle<{ ok: true }>(res);
}

/** URL for a release's cover image. Pass `cacheBust` (e.g. the release's `updatedAt`) after
 * replacing a cover so the <img> doesn't serve a stale cached copy. */
export function coverUrl(id: string, cacheBust?: string | null): string {
  const base = `/api/releases/${encodeURIComponent(id)}/cover`;
  return cacheBust ? `${base}?t=${encodeURIComponent(cacheBust)}` : base;
}
