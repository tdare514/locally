import type { DownloadTicket } from "../../shared/types";

export interface CreateUploadParams {
  /** Server-built storage key, e.g. `users/<userId>/releases/<releaseId>/<name>`. */
  key: string;
  bytes: number;
  contentType: string;
}

export interface UploadTicket {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

/**
 * Private object storage for track/cover files. Clients upload and download
 * directly against the URLs this returns — the API function itself never
 * sees the file bytes (Vercel functions cap request bodies at 4.5 MB).
 */
export interface FileStore {
  /** A short-lived URL + method/headers the client uses to PUT the file directly to storage. */
  createUpload(params: CreateUploadParams): Promise<UploadTicket>;
  /** A short-lived URL the client can GET to download the file. */
  createDownload(key: string): Promise<DownloadTicket>;
  /** Permanently delete the object at `key`. Safe to call on a key that doesn't exist. */
  delete(key: string): Promise<void>;
  /**
   * Permanently delete many objects in one round trip where the backend allows
   * it (Vercel Blob `del([...])`). Empty input is a no-op. Safe on missing keys.
   */
  deleteMany(keys: string[]): Promise<void>;
}
