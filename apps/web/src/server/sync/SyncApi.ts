import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { PublicError } from "../../shared/errors";
import type { CloudPlaysProblem } from "../../shared/types";
import {
  PlayCountsResultSchema,
  ServerPlaysSummaryPageSchema,
  ServerReleasePlaysSchema,
  type PlayCountsResult,
  type PlayEntry,
  type ServerPlaysSummaryPage,
  type ServerReleasePlays,
} from "../plays/playsWire";
import {
  CreateShareResponseSchema,
  RESHARE_REFUSED,
  ReceivedSharesPageSchema,
  SentSharesPageSchema,
  type CreateShareRequest,
  type CreateShareResponse,
  type ReshareRequest,
  type ReceivedSharesPage,
  type SentSharesPage,
} from "../../shared/shares";
import { parseCollectionRecord, type CollectionRecord, type CollectionsPage } from "../../shared/collections";
import { SyncRecordRejectedError, parseSyncRecord, type SyncRecord } from "./SyncRecord";

export type SyncPlatform = "mac" | "ios";

export interface SyncUser {
  id: string;
  email: string;
}

export interface SyncDevice {
  id: string;
  name: string;
}

export interface SyncQuota {
  usedBytes: number;
  limitBytes: number;
}

export interface SyncUploadTarget {
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface SyncFileToUpload {
  name: string;
  bytes: number;
  contentType: string;
}

export interface VerifyCodeResult {
  token: string;
  user: SyncUser;
  device: SyncDevice;
}

export interface MeResult {
  user: SyncUser;
  device: SyncDevice;
  quota: SyncQuota;
  devices: SyncDevice[];
  devicesHasMore?: boolean;
  /** When any device last asked for a resync (#172), ISO; null if never. Absent on an older service. */
  resyncRequestedAt?: string | null;
  /** Whether the service has public share links switched on (#146); the Link option is hidden unless true. Absent on an older service. */
  publicSharesEnabled?: boolean;
}

export interface ListReleasesResult {
  releases: (SyncRecord & { version: number })[];
  nextVersion: number;
  hasMore: boolean;
}

/** One release `GET /v1/files/missing` lists: its record names files that are not stored (#170). */
export interface MissingRelease {
  id: string;
  /** The names the record references that have no stored file. Counted, never shown. */
  missing: string[];
  recordUpdatedAt: string;
}

export interface MissingFilesResult {
  releases: MissingRelease[];
  checkedAt: string;
}

const MissingFilesResultSchema = z.object({
  releases: z.array(z.object({ id: z.string(), missing: z.array(z.string()), recordUpdatedAt: z.string() })),
  checkedAt: z.string(),
});

const ResyncRequestResultSchema = z.object({ resyncRequestedAt: z.string() });

/** Page size requested per `listReleases` call (server clamps to this max anyway). */
export const RELEASE_PAGE_LIMIT = 200;

/** How long `releasePlays` waits for the service before giving up. */
const PLAYS_READ_TIMEOUT_MS = 5_000;
/** How long the missing-files check and the resync request wait; both are optional extras. */
const FILES_REPAIR_TIMEOUT_MS = 10_000;
/** How long the Spotify link calls wait (#307). */
const SPOTIFY_LINK_TIMEOUT_MS = 10_000;
/** How long `pushPlays` waits; a batch of 500 entries is a small body, so this is generous. */
const PLAYS_PUSH_TIMEOUT_MS = 15_000;

/** Thrown by `putRelease` on a 409: the server's stored `updatedAt` is newer than ours. */
export class SyncConflictError extends Error {}

/** Thrown by `putCollection` on a 409 `too_many_collections`: the service holds as many collections as it allows (#349). */
export class TooManyCollectionsError extends Error {}

/** Thrown for any other failed response (not 401 or 409), carrying its HTTP status. Still a
 * `PublicError`, so callers that only care that it failed behave as before. */
export class SyncRequestError extends PublicError {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Thrown by the `/v1/spotify/link` calls on a 404: this server has no online play counting (#305). */
export class SyncUnavailableError extends Error {}

/** Why online counting is not running right now, as the service reports it (#305). */
export type SpotifyLinkProblem = CloudPlaysProblem;

/** `GET /v1/spotify/link`. */
export type SpotifyLinkStatus =
  | { linked: false }
  | { linked: true; since: string | null; lastSampleAt: string | null; problem: SpotifyLinkProblem | null };

/** The spec sends epoch milliseconds; an ISO string is accepted too. Both become an ISO string, anything else null. */
const LinkTimeSchema = z
  .union([z.number(), z.string()])
  .nullable()
  .default(null)
  .transform((v): string | null => {
    if (v === null) return null;
    const ms = typeof v === "number" ? v : Date.parse(v);
    return Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime()) ? new Date(ms).toISOString() : null;
  });

const SpotifyLinkStatusSchema = z.union([
  z.object({ linked: z.literal(false) }),
  z.object({
    linked: z.literal(true),
    since: LinkTimeSchema,
    lastSampleAt: LinkTimeSchema,
    // An unknown problem word from a newer server reads as the generic "reconnect".
    problem: z
      .string()
      .nullable()
      .default(null)
      .transform((p): SpotifyLinkProblem | null =>
        p === null ? null : p === "notOnTesterList" || p === "rateLimited" ? p : "reconnect",
      ),
  }),
]);

const SpotifyLinkStartSchema = z.object({ authorizeUrl: z.string() });

/** Thrown on a 401: the device token has been revoked or is otherwise no longer valid. */
export class SyncAuthError extends Error {}

/**
 * Client for the hosted sync service described in `spec/sync.md`. Method
 * names mirror the API table there 1:1, plus `revokeDevice` (used by sign
 * out) and the `uploadFile`/`downloadFile` streaming helpers (uploads/
 * downloads go straight to/from object storage via short-lived URLs, never
 * buffering a whole track in process memory).
 */
export interface SyncApi {
  requestCode(email: string): Promise<void>;
  verifyCode(
    email: string,
    code: string,
    deviceName: string,
    platform: SyncPlatform,
    installId?: string
  ): Promise<VerifyCodeResult>;
  me(): Promise<MeResult>;
  revokeDevice(deviceId: string): Promise<void>;
  /** `DELETE /v1/me`: deletes the account, its devices, releases and files. Every device token
   * (including this one) is invalid the moment it returns; a 401 keeps throwing `SyncAuthError`. */
  deleteAccount(email: string): Promise<void>;
  listReleases(sinceVersion: number, limit: number): Promise<ListReleasesResult>;
  putRelease(record: SyncRecord): Promise<{ version: number }>;
  deleteRelease(id: string): Promise<{ version: number }>;
  /** `GET /v1/collections` (#349), one page. Throws `SyncRequestError` with the status on a 404 or 429. */
  listCollections(sinceVersion: number, limit: number): Promise<CollectionsPage>;
  /** `PUT /v1/collections/:id`. A 409 throws `SyncConflictError` (the service copy is newer) or
   * `TooManyCollectionsError`; a 404 or 429 throws `SyncRequestError` with the status. */
  putCollection(record: CollectionRecord): Promise<{ version: number; pruned: number }>;
  /** `DELETE /v1/collections/:id`: a tombstone. */
  deleteCollection(id: string): Promise<{ version: number }>;
  createUploads(id: string, files: SyncFileToUpload[]): Promise<{ uploads: SyncUploadTarget[] }>;
  downloadUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }>;
  /** `PUT /v1/plays`: this device's absolute per-track counts, at most 500 entries per call. The
   * service keeps `max(stored, sent)`, so a repeated push is harmless. */
  pushPlays(counts: PlayEntry[]): Promise<PlayCountsResult>;
  /** `GET /v1/releases/:id/plays`: every device's count for the release's tracks. */
  releasePlays(releaseId: string): Promise<ServerReleasePlays>;
  /** `GET /v1/plays/summary?from&to[&cursor]`: one page of every device's plays in the date range
   * and all time (#201). Throws `SyncRequestError` with the status on a 404 or 429. */
  playsSummary(from: string, to: string, cursor?: string): Promise<ServerPlaysSummaryPage>;
  /** `GET /v1/files/missing`: the caller's releases whose files are not stored. Resolves null when
   * the service answers 404, an API from before #170: callers carry on as they did without it. */
  missingFiles(): Promise<MissingFilesResult | null>;
  /** `POST /v1/files/resync-request`: asks the account's other devices to upload again. Resolves
   * null on a 404 (an API from before #170). */
  requestResync(): Promise<{ resyncRequestedAt: string } | null>;
  /** `POST /v1/spotify/link`: starts linking this account's Spotify to the service (#307). Throws
   * `SyncUnavailableError` on a 404 and `SyncRequestError` (429) when rate-limited. */
  spotifyLinkStart(timeZone: string): Promise<{ authorizeUrl: string }>;
  /** `GET /v1/spotify/link`. Throws `SyncUnavailableError` on a 404, a server without the feature. */
  spotifyLinkStatus(): Promise<SpotifyLinkStatus>;
  /** `DELETE /v1/spotify/link`. Throws `SyncUnavailableError` on a 404. */
  spotifyUnlink(): Promise<void>;
  /** `POST /v1/shares`. A release added in place (`source: "adopted"`, a 409) throws a `PublicError` saying so;
   * a private share where no recipient resolves is `share: null`. */
  createShare(body: CreateShareRequest): Promise<CreateShareResponse>;
  /** `POST /v1/shares/:id/reshare` (#328): a child share of a received share, same reply as create. A 403
   * `reshare_not_allowed` or `use_reshare` throws a `PublicError` with `RESHARE_REFUSED`. */
  reshareShare(id: string, body: ReshareRequest): Promise<CreateShareResponse>;
  /** `GET /v1/shares?role=sent`, one page, newest first. */
  listSentShares(cursor?: string | null, limit?: number): Promise<SentSharesPage>;
  /** `GET /v1/shares?role=received`, one page: live shares only. */
  listReceivedShares(cursor?: string | null, limit?: number): Promise<ReceivedSharesPage>;
  /** `DELETE /v1/shares/:id`: revokes it and every reshare below it. */
  revokeShare(id: string): Promise<void>;
  /** `GET /v1/shares/:id/files/:name`: a 5-minute signed URL for one of the share's files. */
  shareFileUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }>;
  /** `POST /v1/shares/:id/claim`: idempotent; the caller then imports the share. */
  claimShare(id: string): Promise<{ claimedAt: string }>;
  /** `POST /v1/shares/:id/hide`: dismisses a received share from the tray. */
  hideShare(id: string): Promise<void>;
  /** Streams `filePath` to the given upload target without buffering it in memory. */
  uploadFile(upload: SyncUploadTarget, filePath: string): Promise<void>;
  /** Streams the response body at `url` to `destPath` without buffering it in memory. */
  downloadFile(url: string, destPath: string): Promise<void>;
}

/** `SyncApi` implemented with `fetch` against a real (or locally-running) sync service. */
export class HttpSyncApi implements SyncApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null
  ) {}

  private url(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString();
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async handle<T>(res: Response): Promise<T> {
    if (res.status === 409) {
      throw new SyncConflictError("A newer version of this release exists on the server");
    }
    if (res.status === 401) {
      throw new SyncAuthError("Sync sign-in has expired; please sign in again");
    }
    if (!res.ok) {
      let message = `Sync request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // ignore parse errors, fall back to the generic message
      }
      throw new SyncRequestError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async requestCode(email: string): Promise<void> {
    const res = await fetch(this.url("/v1/auth/code"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ email }),
    });
    await this.handle(res);
  }

  async verifyCode(
    email: string,
    code: string,
    deviceName: string,
    platform: SyncPlatform,
    installId?: string
  ): Promise<VerifyCodeResult> {
    const res = await fetch(this.url("/v1/auth/verify"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ email, code, deviceName, platform, ...(installId ? { installId } : {}) }),
    });
    return this.handle<VerifyCodeResult>(res);
  }

  async me(): Promise<MeResult> {
    const res = await fetch(this.url("/v1/me"), { headers: this.headers(false) });
    return this.handle<MeResult>(res);
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const res = await fetch(this.url(`/v1/devices/${encodeURIComponent(deviceId)}`), {
      method: "DELETE",
      headers: this.headers(false),
    });
    await this.handle(res);
  }

  async deleteAccount(email: string): Promise<void> {
    const res = await fetch(this.url("/v1/me"), {
      method: "DELETE",
      headers: this.headers(true),
      body: JSON.stringify({ email }),
    });
    await this.handle(res);
  }

  async listReleases(sinceVersion: number, limit: number): Promise<ListReleasesResult> {
    const res = await fetch(
      this.url(
        `/v1/releases?sinceVersion=${encodeURIComponent(String(sinceVersion))}&limit=${encodeURIComponent(String(limit))}`
      ),
      { headers: this.headers(false) }
    );
    const body = await this.handle<{ releases: unknown[]; nextVersion: number; hasMore?: unknown }>(res);
    const releases: ListReleasesResult["releases"] = [];
    for (const raw of body.releases) {
      let record: SyncRecord;
      try {
        record = parseSyncRecord(raw);
      } catch (err) {
        // A record naming a file this app won't use is skipped, not fatal: the rest of the
        // page and the cursor still advance, matching iOS. A structurally broken record still
        // fails the page.
        if (err instanceof SyncRecordRejectedError) {
          console.warn(`SyncApi: skipping ${err.message}`);
          continue;
        }
        throw err;
      }
      const version = (raw as { version?: unknown }).version;
      releases.push({ ...record, version: typeof version === "number" ? version : 0 });
    }
    return { releases, nextVersion: body.nextVersion, hasMore: body.hasMore === true };
  }

  async putRelease(record: SyncRecord): Promise<{ version: number }> {
    const res = await fetch(this.url(`/v1/releases/${encodeURIComponent(record.id)}`), {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(record),
    });
    return this.handle<{ version: number }>(res);
  }

  async deleteRelease(id: string): Promise<{ version: number }> {
    const res = await fetch(this.url(`/v1/releases/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: this.headers(false),
    });
    return this.handle<{ version: number }>(res);
  }

  async listCollections(sinceVersion: number, limit: number): Promise<CollectionsPage> {
    const res = await fetch(
      this.url(`/v1/collections?sinceVersion=${encodeURIComponent(String(sinceVersion))}&limit=${encodeURIComponent(String(limit))}`),
      { headers: this.headers(false) }
    );
    const body = await this.handle<{ collections: unknown[]; nextVersion: number; hasMore?: unknown }>(res);
    const collections: CollectionsPage["collections"] = [];
    for (const raw of body.collections) {
      const record = parseCollectionRecord(raw);
      if (!record) {
        console.warn("SyncApi: skipping a collection record that does not parse");
        continue;
      }
      const version = (raw as { version?: unknown }).version;
      collections.push({ ...record, version: typeof version === "number" ? version : 0 });
    }
    return { collections, nextVersion: body.nextVersion, hasMore: body.hasMore === true };
  }

  async putCollection(record: CollectionRecord): Promise<{ version: number; pruned: number }> {
    const res = await fetch(this.url(`/v1/collections/${encodeURIComponent(record.id)}`), {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(record),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === "too_many_collections") throw new TooManyCollectionsError("Too many collections");
    }
    const out = await this.handle<{ version: number; pruned?: number }>(res);
    return { version: out.version, pruned: typeof out.pruned === "number" ? out.pruned : 0 };
  }

  async deleteCollection(id: string): Promise<{ version: number }> {
    const res = await fetch(this.url(`/v1/collections/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: this.headers(false),
    });
    return this.handle<{ version: number }>(res);
  }

  async createUploads(id: string, files: SyncFileToUpload[]): Promise<{ uploads: SyncUploadTarget[] }> {
    const res = await fetch(this.url(`/v1/releases/${encodeURIComponent(id)}/files`), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ files }),
    });
    return this.handle<{ uploads: SyncUploadTarget[] }>(res);
  }

  async downloadUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }> {
    const res = await fetch(
      this.url(`/v1/releases/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`),
      { headers: this.headers(false) }
    );
    return this.handle<{ url: string; expiresAt: string }>(res);
  }

  async pushPlays(counts: PlayEntry[]): Promise<PlayCountsResult> {
    const res = await fetch(this.url("/v1/plays"), {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify({ counts }),
      signal: AbortSignal.timeout(PLAYS_PUSH_TIMEOUT_MS),
    });
    const parsed = PlayCountsResultSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a play count push");
    return parsed.data;
  }

  async releasePlays(releaseId: string): Promise<ServerReleasePlays> {
    const res = await fetch(this.url(`/v1/releases/${encodeURIComponent(releaseId)}/plays`), {
      headers: this.headers(false),
      // A slow service must not hold the release page's counts hostage; the caller falls back to this Mac's.
      signal: AbortSignal.timeout(PLAYS_READ_TIMEOUT_MS),
    });
    const parsed = ServerReleasePlaysSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply for a release's play counts");
    return parsed.data;
  }

  async playsSummary(from: string, to: string, cursor?: string): Promise<ServerPlaysSummaryPage> {
    const query = new URLSearchParams({ from, to });
    if (cursor) query.set("cursor", cursor);
    const res = await fetch(this.url(`/v1/plays/summary?${query.toString()}`), {
      headers: this.headers(false),
      // A slow service must not hold the stats hostage; the caller falls back to this Mac's.
      signal: AbortSignal.timeout(PLAYS_READ_TIMEOUT_MS),
    });
    const parsed = ServerPlaysSummaryPageSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply for the play summary");
    return parsed.data;
  }

  async missingFiles(): Promise<MissingFilesResult | null> {
    const res = await fetch(this.url("/v1/files/missing"), {
      headers: this.headers(false),
      signal: AbortSignal.timeout(FILES_REPAIR_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    const parsed = MissingFilesResultSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a missing files check");
    return parsed.data;
  }

  async requestResync(): Promise<{ resyncRequestedAt: string } | null> {
    const res = await fetch(this.url("/v1/files/resync-request"), {
      method: "POST",
      headers: this.headers(false),
      signal: AbortSignal.timeout(FILES_REPAIR_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    const parsed = ResyncRequestResultSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a resync request");
    return parsed.data;
  }

  async spotifyLinkStart(timeZone: string): Promise<{ authorizeUrl: string }> {
    const res = await fetch(this.url("/v1/spotify/link"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ timeZone }),
      signal: AbortSignal.timeout(SPOTIFY_LINK_TIMEOUT_MS),
    });
    if (res.status === 404) throw new SyncUnavailableError("Online play counting is not available on this sync service");
    const parsed = SpotifyLinkStartSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a Spotify link request");
    return parsed.data;
  }

  async spotifyLinkStatus(): Promise<SpotifyLinkStatus> {
    const res = await fetch(this.url("/v1/spotify/link"), {
      headers: this.headers(false),
      signal: AbortSignal.timeout(SPOTIFY_LINK_TIMEOUT_MS),
    });
    if (res.status === 404) throw new SyncUnavailableError("Online play counting is not available on this sync service");
    const parsed = SpotifyLinkStatusSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply for the Spotify link");
    return parsed.data;
  }

  async spotifyUnlink(): Promise<void> {
    const res = await fetch(this.url("/v1/spotify/link"), {
      method: "DELETE",
      headers: this.headers(false),
      signal: AbortSignal.timeout(SPOTIFY_LINK_TIMEOUT_MS),
    });
    if (res.status === 404) throw new SyncUnavailableError("Online play counting is not available on this sync service");
    await this.handle(res);
  }

  async createShare(body: CreateShareRequest): Promise<CreateShareResponse> {
    const res = await fetch(this.url("/v1/shares"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    // `handle` reads a 409 as a release conflict; here it only means "adopted".
    if (res.status === 409) {
      throw new PublicError("This release was added in place from a Spotify folder, so Locally can't share it.");
    }
    await this.refuseReshare(res);
    const parsed = CreateShareResponseSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a share");
    return parsed.data;
  }

  async reshareShare(id: string, body: ReshareRequest): Promise<CreateShareResponse> {
    const res = await fetch(this.url(`/v1/shares/${encodeURIComponent(id)}/reshare`), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    await this.refuseReshare(res);
    const parsed = CreateShareResponseSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply to a share");
    return parsed.data;
  }

  /** A 403 saying this release may not be shared on becomes the one plain sentence. */
  private async refuseReshare(res: Response): Promise<void> {
    if (res.status !== 403) return;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body.error === "use_reshare" || body.error === "reshare_not_allowed") throw new PublicError(RESHARE_REFUSED);
    } catch (err) {
      if (err instanceof PublicError) throw err;
    }
  }

  private sharesQuery(role: "sent" | "received", cursor: string | null | undefined, limit: number): string {
    const query = new URLSearchParams({ role, limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return `/v1/shares?${query.toString()}`;
  }

  async listSentShares(cursor?: string | null, limit = 50): Promise<SentSharesPage> {
    const res = await fetch(this.url(this.sharesQuery("sent", cursor, limit)), { headers: this.headers(false) });
    const parsed = SentSharesPageSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply for your shares");
    return parsed.data;
  }

  async listReceivedShares(cursor?: string | null, limit = 50): Promise<ReceivedSharesPage> {
    const res = await fetch(this.url(this.sharesQuery("received", cursor, limit)), { headers: this.headers(false) });
    const parsed = ReceivedSharesPageSchema.safeParse(await this.handle<unknown>(res));
    if (!parsed.success) throw new PublicError("Sync service sent an unexpected reply for shares sent to you");
    return parsed.data;
  }

  async revokeShare(id: string): Promise<void> {
    const res = await fetch(this.url(`/v1/shares/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: this.headers(false),
    });
    await this.handle(res);
  }

  async shareFileUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }> {
    const res = await fetch(this.url(`/v1/shares/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`), {
      headers: this.headers(false),
    });
    return this.handle<{ url: string; expiresAt: string }>(res);
  }

  async claimShare(id: string): Promise<{ claimedAt: string }> {
    const res = await fetch(this.url(`/v1/shares/${encodeURIComponent(id)}/claim`), {
      method: "POST",
      headers: this.headers(false),
    });
    return this.handle<{ claimedAt: string }>(res);
  }

  async hideShare(id: string): Promise<void> {
    const res = await fetch(this.url(`/v1/shares/${encodeURIComponent(id)}/hide`), {
      method: "POST",
      headers: this.headers(false),
    });
    await this.handle(res);
  }

  async uploadFile(upload: SyncUploadTarget, filePath: string): Promise<void> {
    const stat = await fs.stat(filePath);
    const stream = createReadStream(filePath);
    // Node's fetch (undici) streams a Node Readable directly as the request
    // body when `duplex: "half"` is set; the DOM `RequestInit` type doesn't
    // know about either, so the init is built loosely and cast at the call.
    const init: Record<string, unknown> = {
      method: upload.method || "PUT",
      headers: { ...upload.headers, "Content-Length": String(stat.size) },
      body: stream,
      duplex: "half",
    };
    const res = await fetch(upload.url, init as RequestInit);
    if (!res.ok) {
      throw new PublicError(`Upload failed (${res.status}) for ${path.basename(filePath)}`);
    }
  }

  async downloadFile(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new PublicError(`Download failed (${res.status}) for ${path.basename(destPath)}`);
    }
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const nodeReadable = Readable.fromWeb(res.body as never);
    const out = createWriteStream(destPath);
    await pipeline(nodeReadable, out);
  }
}
