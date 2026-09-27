import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import type { DownloadTicket } from "../../shared/types";
import type { CreateUploadParams, FileStore, UploadTicket } from "./FileStore";

const TICKET_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Production `FileStore`: a private Vercel Blob store, selected with
 * `FILE_STORE=blob` (`BLOB_READ_WRITE_TOKEN` required).
 *
 * `spec/sync.md` requires clients to upload/download with a short-lived
 * *URL* — no SDK involved, since the iOS client is Swift and can't run
 * `@vercel/blob`'s JS client helpers (`upload()`/`put()` with a client
 * token). `@vercel/blob`'s newer `issueSignedToken` + `presignUrl` pair
 * (Vercel Signed URLs) is the part of the current SDK that actually
 * produces that: a plain, short-lived `PUT`/`GET` URL any HTTP client can
 * use directly, scoped to one pathname, content type and size. That's what
 * this class uses. `generateClientTokenFromReadWriteToken`/`handleUpload`
 * remain the right tool for a browser-only client driven by the SDK, which
 * isn't the shape this API needs here.
 */
export class VercelBlobFileStore implements FileStore {
  constructor(private readonly readWriteToken: string) {}

  async createUpload({ key, bytes, contentType }: CreateUploadParams): Promise<UploadTicket> {
    const validUntil = Date.now() + TICKET_LIFETIME_MS;
    const signed = await issueSignedToken({
      token: this.readWriteToken,
      pathname: key,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: bytes,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "put",
      pathname: key,
      access: "private",
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: bytes,
      allowOverwrite: true,
    });
    return {
      url: presignedUrl,
      method: "PUT",
      headers: { "Content-Type": contentType },
    };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    const validUntil = Date.now() + TICKET_LIFETIME_MS;
    const signed = await issueSignedToken({
      token: this.readWriteToken,
      pathname: key,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "get",
      pathname: key,
      access: "private",
      validUntil,
    });
    return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
  }

  async delete(key: string): Promise<void> {
    await del(key, { token: this.readWriteToken });
  }
}
