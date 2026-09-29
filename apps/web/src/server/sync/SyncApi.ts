import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PublicError } from "../../shared/errors";
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
}

export interface ListReleasesResult {
  releases: (SyncRecord & { version: number })[];
  nextVersion: number;
  hasMore: boolean;
}

/** Page size requested per `listReleases` call (server clamps to this max anyway). */
export const RELEASE_PAGE_LIMIT = 200;

/** Thrown by `putRelease` on a 409: the server's stored `updatedAt` is newer than ours. */
export class SyncConflictError extends Error {}

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
  verifyCode(email: string, code: string, deviceName: string, platform: SyncPlatform): Promise<VerifyCodeResult>;
  me(): Promise<MeResult>;
  revokeDevice(deviceId: string): Promise<void>;
  /** `DELETE /v1/me`: deletes the account, its devices, releases and files. Every device token
   * (including this one) is invalid the moment it returns; a 401 keeps throwing `SyncAuthError`. */
  deleteAccount(email: string): Promise<void>;
  listReleases(sinceVersion: number, limit: number): Promise<ListReleasesResult>;
  putRelease(record: SyncRecord): Promise<{ version: number }>;
  deleteRelease(id: string): Promise<{ version: number }>;
  createUploads(id: string, files: SyncFileToUpload[]): Promise<{ uploads: SyncUploadTarget[] }>;
  downloadUrl(id: string, name: string): Promise<{ url: string; expiresAt: string }>;
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
      throw new PublicError(message);
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
    platform: SyncPlatform
  ): Promise<VerifyCodeResult> {
    const res = await fetch(this.url("/v1/auth/verify"), {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ email, code, deviceName, platform }),
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
