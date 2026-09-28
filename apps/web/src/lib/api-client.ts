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
} from "../shared/types";

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

export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings");
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

export async function acceptFromPhone(id: string): Promise<{ ok: true; release: Release }> {
  const res = await fetch(`/api/sync/accept/${encodeURIComponent(id)}`, { method: "POST" });
  return handle<{ ok: true; release: Release }>(res);
}

export async function getLibrary(): Promise<Library> {
  const res = await fetch("/api/library");
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
