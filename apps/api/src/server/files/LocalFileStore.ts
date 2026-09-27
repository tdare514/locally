import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

  private sign(key: string, expiresAt: number): string {
    return crypto.createHmac("sha256", this.signingKey).update(`${key}:${expiresAt}`).digest("hex");
  }

  /** Used by the local-upload/local-download routes to verify a request's `sig`/`exp` query params. */
  verifySignature(key: string, expiresAtRaw: string | null, signatureRaw: string | null): boolean {
    if (!expiresAtRaw || !signatureRaw) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt < this.now()) return false;

    const expected = Buffer.from(this.sign(key, expiresAt), "hex");
    const actual = Buffer.from(signatureRaw, "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  /** Resolve a storage key to an absolute path on disk, used by the local-storage routes. */
  absolutePathFor(key: string): string {
    return path.join(this.rootDir, key);
  }

  async createUpload({ key, contentType }: CreateUploadParams): Promise<UploadTicket> {
    const expiresAt = this.now() + TICKET_LIFETIME_MS;
    const sig = this.sign(key, expiresAt);
    return {
      url: `${this.publicBaseUrl}/v1/internal/local-upload/${key}?exp=${expiresAt}&sig=${sig}`,
      method: "PUT",
      headers: { "Content-Type": contentType },
    };
  }

  async createDownload(key: string): Promise<DownloadTicket> {
    const expiresAt = this.now() + TICKET_LIFETIME_MS;
    const sig = this.sign(key, expiresAt);
    return {
      url: `${this.publicBaseUrl}/v1/internal/local-download/${key}?exp=${expiresAt}&sig=${sig}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.absolutePathFor(key), { force: true });
  }

  /** Write a request body to disk at `key`, creating parent directories as needed. */
  async writeFromRequest(key: string, body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) {
      throw new Error("Upload request had no body");
    }
    const dest = this.absolutePathFor(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
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
