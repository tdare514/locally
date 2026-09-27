import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";

function streamOf(data: Buffer): ReadableStream<Uint8Array> {
  const body = new Response(new Uint8Array(data)).body;
  if (!body) throw new Error("Response had no body");
  return body;
}

describe("LocalFileStore", () => {
  let rootDir: string;
  let clock: number;
  let store: LocalFileStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "sli-local-file-store-"));
    clock = Date.UTC(2026, 0, 1);
    store = new LocalFileStore(rootDir, "http://localhost:4000", "test-token-pepper", () => clock);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("round-trips bytes through a signed upload then a signed download", async () => {
    const key = "users/u1/releases/r1/01 - Track.mp3";
    const bytes = Buffer.from("fake mp3 bytes, but bytes all the same");

    const upload = await store.createUpload({ key, bytes: bytes.length, contentType: "audio/mpeg" });
    expect(upload.method).toBe("PUT");
    expect(upload.url).toContain("/v1/internal/local-upload/");

    const uploadUrl = new URL(upload.url);
    const uploadValid = store.verifySignature(key, uploadUrl.searchParams.get("exp"), uploadUrl.searchParams.get("sig"));
    expect(uploadValid).toBe(true);

    await store.writeFromRequest(key, streamOf(bytes));

    const download = await store.createDownload(key);
    const downloadUrl = new URL(download.url);
    const downloadValid = store.verifySignature(
      key,
      downloadUrl.searchParams.get("exp"),
      downloadUrl.searchParams.get("sig")
    );
    expect(downloadValid).toBe(true);

    const readBack = await store.readFile(key);
    expect(readBack?.equals(bytes)).toBe(true);
  });

  it("rejects a signature for the wrong key", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1, contentType: "audio/mpeg" });
    const url = new URL(upload.url);
    const valid = store.verifySignature("a/other.mp3", url.searchParams.get("exp"), url.searchParams.get("sig"));
    expect(valid).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1, contentType: "audio/mpeg" });
    const url = new URL(upload.url);
    const tampered = `${url.searchParams.get("sig")?.slice(0, -2)}00`;
    expect(store.verifySignature("a/b.mp3", url.searchParams.get("exp"), tampered)).toBe(false);
  });

  it("rejects an expired signature", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1, contentType: "audio/mpeg" });
    const url = new URL(upload.url);

    clock += 6 * 60 * 1000; // past the 5-minute ticket lifetime

    const valid = store.verifySignature("a/b.mp3", url.searchParams.get("exp"), url.searchParams.get("sig"));
    expect(valid).toBe(false);
  });

  it("readFile returns null for a file that was never written", async () => {
    expect(await store.readFile("nothing/here.mp3")).toBeNull();
  });

  it("delete removes a written file", async () => {
    const key = "a/b.mp3";
    await store.writeFromRequest(key, streamOf(Buffer.from("x")));
    expect(await store.readFile(key)).not.toBeNull();

    await store.delete(key);
    expect(await store.readFile(key)).toBeNull();
  });
});
