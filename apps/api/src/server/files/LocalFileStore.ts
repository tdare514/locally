import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UploadTooLargeError } from "../../shared/errors";
import type { DownloadTicket } from "../../shared/types";
import type { CreateUploadParams, FileStore, UploadTicket } from "./FileStore";

const TICKET_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Development/test `FileStore`: a folder on disk under `apps/api/data/files`,
 * served by this same app through the `/v1/internal/local-*` routes with
 * HMAC-signed, expiring URLs — so the "signed URL" contract clients rely on
 * is real in local dev, not just a stand-in for production Blob storage.
 *
 * The signing key is derived from `TOKEN_PEPPER` with domain separation
 * (never the pepper bytes directly), so no extra env var is needed beyond
 * the ones already in `.env.example`.
 */
export class LocalFileStore implements FileStore {
  private readonly signingKey: Buffer;

  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
    tokenPepper: string,
    private readonly now: () => number = () => Date.now()
  ) {
    this.signingKey = crypto.createHash("sha256").update(`local-file-store:${tokenPepper}`).digest();
  }

  /**
   * Upload and download signatures are domain-separated (`upload:`/`download:`
   * prefixes) so a signature minted for one can never verify as the other,
   * and an upload signature also covers the declared byte count so a client
   * can't shrink `bytes` to slip past the quota check and then PUT a larger
   * body than it declared.
   */
  private signUpload(key: string, expiresAt: number, maxBytes: number): string {
    return crypto.createHmac("sha256", this.signingKey).update(`upload:${key}:${expiresAt}:${maxBytes}`).digest("hex");
  }

  private signDownload(key: string, expiresAt: number): string {
    return crypto.createHmac("sha256", this.signingKey).update(`download:${key}:${expiresAt}`).digest("hex");
  }

  private verifyHex(expected: string, actualRaw: string): boolean {
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(actualRaw, "hex");
    return expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  /**
   * Used by the local-upload route to verify a request's `exp`/`max`/`sig`
   * query params. Returns the verified max byte count (from the signed
   * `max`, not the raw query param) or `null` if the signature, expiry, or
   * `max` value doesn't check out.
   */
  verifyUploadSignature(key: string, expiresAtRaw: string | null, maxBytesRaw: string | null, signatureRaw: string | null): number | null {
    if (!expiresAtRaw || !maxBytesRaw || !signatureRaw) return null;
    const expiresAt = Number(expiresAtRaw);
    const maxBytes = Number(maxBytesRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < this.now()) return null;
    if (!Number.isFinite(maxBytes) || maxBytes < 0) return null;

    if (!this.verifyHex(this.signUpload(key, expiresAt, maxBytes), signatureRaw)) return null;
    return maxBytes;
  }

  /** Used by the local-download route to verify a request's `exp`/`sig` query params. */
  verifyDownloadSignature(key: string, expiresAtRaw: string | null, signatureRaw: string | null): boolean {
    if (!expiresAtRaw || !signatureRaw) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < this.now()) return false;

    return this.verifyHex(this.signDownload(key, expiresAt), signatureRaw);
  }

  /**
   * Resolve a storage key to an absolute path on disk, used by every method
   * below that touches the filesystem. Keys are server-generated (never
   * client input — see `storageKeyFor`), but this is inside-checked anyway
   * per the repo's "every user-derived path is sanitised and inside-checked"
   * invariant: throws if the resolved path escapes `rootDir`.
   */
  absolutePathFor(key: string): string {
    const resolvedRoot = path.resolve(this.rootDir);
    const target = path.resolve(resolvedRoot, key);
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Storage key resolves outside the file store root: ${key}`);
    }
    return target;
  }

  async createUpload({ key, bytes, contentType }: CreateUploadParams): Promise<UploadTicket> {
    const expiresAt = this.now() + TICKET_LIFETIME_MS;
    const sig = this.signUpload(key, expiresAt, bytes);
    return {
      url: `${this.publicBaseUrl}/v1/internal/local-upload/${key}?exp=${expiresAt}&max=${bytes}&sig=${sig}`,
      method: "PUT",
      headers: { "Content-Type": contentType },
    };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    const expiresAt = this.now() + TICKET_LIFETIME_MS;
    const sig = this.signDownload(key, expiresAt);
    return {
      url: `${this.publicBaseUrl}/v1/internal/local-download/${key}?exp=${expiresAt}&sig=${sig}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async delete(key: string): Promise<void> {
    await this.deleteMany([key]);
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await Promise.all(keys.map((key) => fs.rm(this.absolutePathFor(key), { force: true })));
  }

  /**
   * Write a request body to disk at `key`, creating parent directories as
   * needed. Streams the body and tracks a running total so a body larger
   * than `maxBytes` (the size verified from the upload signature) is
   * rejected — and the underlying reader cancelled — before anything is
   * written to disk.
   */
  async writeFromRequest(key: string, body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<void> {
    if (!body) {
      throw new Error("Upload request had no body");
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Best-effort: we're already failing the request.
        }
        throw new UploadTooLargeError(`Upload exceeded the declared ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }

    if (total === 0) {
      throw new Error("Upload request had no body");
    }

    const dest = this.absolutePathFor(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.concat(chunks));
  }

  async readFile(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.absolutePathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
