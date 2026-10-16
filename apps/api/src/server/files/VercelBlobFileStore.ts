import { del, issueSignedToken, list, presignUrl } from "@vercel/blob";
import type { DownloadTicket } from "../../shared/types";
import type { CreateUploadParams, FileStore, UploadTicket } from "./FileStore";

const TICKET_LIFETIME_MS = 5 * 60 * 1000;

/** The Blob API version `@vercel/blob` 2.x sends as `x-api-version` on its own requests. */
const BLOB_API_VERSION = "12";

/**
 * The Blob pathname handed to the SDK, derived from the storage key.
 *
 * `@vercel/blob`'s `presignUrl` re-reads the pathname it signed into the
 * token by base64-decoding with `atob`, which yields Latin-1, so a key with
 * any non-ASCII character (a curly apostrophe in "It's Over", accents,
 * CJK, emoji) comes back as mojibake and the SDK rejects its own token with
 * "Blob path does not match the signed token scope". So the path the SDK
 * sees must be pure ASCII. Percent-escapes are not an option either: the
 * presigned URL carries the pathname as a query parameter and Blob
 * normalises `%XX` in it before checking the delegation, answering 403
 * "pathname does not match delegation". Each code point outside printable
 * ASCII (space through `~`) is therefore written as its UTF-8 bytes in the
 * form `~XX`, with a literal `~` written as `~7E` so the mapping can't
 * collide. Every key that already uploaded fine is unchanged. The mapping
 * is one-way and applied at every call site here, so the `storageKey`
 * persisted in the database stays the readable, un-encoded key.
 */
export function blobPathname(key: string): string {
  return key.replace(/[^\x20-\x7e]|~/gu, (ch) =>
    Array.from(new TextEncoder().encode(ch), (b) => "~" + b.toString(16).toUpperCase().padStart(2, "0")).join("")
  );
}

/**
 * The inverse of `blobPathname`: turns a pathname the SDK lists back into the
 * storage key it was derived from. Every `~XX` run is a UTF-8 byte sequence,
 * and a literal `~` is always written `~7E`, so any `~` in a pathname this
 * server wrote starts an escape. A `~` not followed by two hex digits (not
 * written by us) is left alone.
 */
export function keyFromBlobPathname(pathname: string): string {
  return pathname.replace(/(?:~[0-9A-F]{2})+/g, (run) =>
    new TextDecoder().decode(Uint8Array.from(run.slice(1).split("~"), (hex) => parseInt(hex, 16)))
  );
}

/** Blob's `list` default page size (1000, per the SDK types), set explicitly so it does not depend on an SDK default. */
const LIST_PAGE_SIZE = 1000;

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
    const pathname = blobPathname(key);
    const validUntil = Date.now() + TICKET_LIFETIME_MS;
    const signed = await issueSignedToken({
      token: this.readWriteToken,
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: bytes,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "put",
      pathname,
      access: "private",
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: bytes,
      allowOverwrite: true,
      // Explicit: the Blob service added a random suffix to presigned PUTs (16 Oct 2026, #266), so every
      // upload landed at "<name>-<random>.<ext>" and every download, list and missing-files check, which
      // use the exact key, found nothing.
      addRandomSuffix: false,
    });
    return {
      url: presignedUrl,
      method: "PUT",
      // The SDK's own put() always sends these two; a raw PUT to the presigned control-plane URL
      // without them answers 200 yet stores nothing a read or list can find (16 Oct 2026, #266:
      // every synced file and cover was "missing"). Both clients send the ticket's headers verbatim.
      headers: {
        "Content-Type": contentType,
        "x-api-version": BLOB_API_VERSION,
        "x-vercel-blob-access": "private",
      },
    };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    const pathname = blobPathname(key);
    const validUntil = Date.now() + TICKET_LIFETIME_MS;
    const signed = await issueSignedToken({
      token: this.readWriteToken,
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
  }

  async delete(key: string): Promise<void> {
    await this.deleteMany([key]);
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await del(
      keys.map((key) => blobPathname(key)),
      { token: this.readWriteToken }
    );
  }

  /**
   * Pages through `list({ prefix, cursor })`, up to 1000 blobs a call, until
   * `hasMore` is false. The prefix goes through `blobPathname` like every
   * other pathname, and each listed pathname is decoded back to its storage
   * key, so callers compare against the keys they built, never the encoding.
   */
  async *listKeys(prefix: string): AsyncGenerator<string> {
    const pathnamePrefix = blobPathname(prefix);
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: pathnamePrefix, limit: LIST_PAGE_SIZE, cursor, token: this.readWriteToken });
      for (const blob of page.blobs) yield keyFromBlobPathname(blob.pathname);
      // A page that says hasMore but sends no cursor ends the listing rather than looping on page one.
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
}
