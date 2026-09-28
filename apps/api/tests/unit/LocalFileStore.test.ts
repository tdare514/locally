import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStore } from "../../src/server/files/LocalFileStore";
import { UploadTooLargeError } from "../../src/shared/errors";

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
    expect(upload.url).toContain(`max=${bytes.length}`);

    const uploadUrl = new URL(upload.url);
    const maxBytes = store.verifyUploadSignature(
      key,
      uploadUrl.searchParams.get("exp"),
      uploadUrl.searchParams.get("max"),
      uploadUrl.searchParams.get("sig")
    );
    expect(maxBytes).toBe(bytes.length);

    await store.writeFromRequest(key, streamOf(bytes), maxBytes!);

    const download = await store.createDownload(key);
    const downloadUrl = new URL(download.url);
    const downloadValid = store.verifyDownloadSignature(
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
    const maxBytes = store.verifyUploadSignature(
      "a/other.mp3",
      url.searchParams.get("exp"),
      url.searchParams.get("max"),
      url.searchParams.get("sig")
    );
    expect(maxBytes).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1, contentType: "audio/mpeg" });
    const url = new URL(upload.url);
    const tampered = `${url.searchParams.get("sig")?.slice(0, -2)}00`;
    expect(
      store.verifyUploadSignature("a/b.mp3", url.searchParams.get("exp"), url.searchParams.get("max"), tampered)
    ).toBeNull();
  });

  it("rejects tampering with the declared max size", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1000, contentType: "audio/mpeg" });
    const url = new URL(upload.url);
    // A client shrinking `max` to pass a quota check, then trying to PUT a larger body.
    const maxBytes = store.verifyUploadSignature("a/b.mp3", url.searchParams.get("exp"), "1", url.searchParams.get("sig"));
    expect(maxBytes).toBeNull();
  });

  it("rejects an expired upload signature", async () => {
    const upload = await store.createUpload({ key: "a/b.mp3", bytes: 1, contentType: "audio/mpeg" });
    const url = new URL(upload.url);

    clock += 6 * 60 * 1000; // past the 5-minute ticket lifetime

    const maxBytes = store.verifyUploadSignature(
      "a/b.mp3",
      url.searchParams.get("exp"),
      url.searchParams.get("max"),
      url.searchParams.get("sig")
    );
    expect(maxBytes).toBeNull();
  });

  it("rejects an expired download signature", async () => {
    const download = await store.createDownload("a/b.mp3");
    const url = new URL(download.url);

    clock += 6 * 60 * 1000; // past the 5-minute ticket lifetime

    const valid = store.verifyDownloadSignature("a/b.mp3", url.searchParams.get("exp"), url.searchParams.get("sig"));
    expect(valid).toBe(false);
  });

  it("an upload signature does not verify as a download signature, and vice versa", async () => {
    const key = "a/b.mp3";
    const upload = await store.createUpload({ key, bytes: 10, contentType: "audio/mpeg" });
    const uploadUrl = new URL(upload.url);
    const download = await store.createDownload(key);
    const downloadUrl = new URL(download.url);

    // The upload's signature, presented as a download signature.
    expect(store.verifyDownloadSignature(key, uploadUrl.searchParams.get("exp"), uploadUrl.searchParams.get("sig"))).toBe(
      false
    );
    // The download's signature, presented as an upload signature.
    expect(
      store.verifyUploadSignature(key, downloadUrl.searchParams.get("exp"), "10", downloadUrl.searchParams.get("sig"))
    ).toBeNull();
  });

  it("readFile returns null for a file that was never written", async () => {
    expect(await store.readFile("nothing/here.mp3")).toBeNull();
  });

  it("delete removes a written file", async () => {
    const key = "a/b.mp3";
    await store.writeFromRequest(key, streamOf(Buffer.from("x")), 10);
    expect(await store.readFile(key)).not.toBeNull();

    await store.delete(key);
    expect(await store.readFile(key)).toBeNull();
  });

  it("rejects a body larger than the declared max, writing nothing to disk", async () => {
    const key = "a/too-big.mp3";
    const bytes = Buffer.from("this body is definitely more than ten bytes long");

    await expect(store.writeFromRequest(key, streamOf(bytes), 10)).rejects.toThrow(UploadTooLargeError);
    expect(await store.readFile(key)).toBeNull();
  });

  it("rejects an empty body", async () => {
    await expect(store.writeFromRequest("a/empty.mp3", streamOf(Buffer.alloc(0)), 100)).rejects.toThrow();
    expect(await store.readFile("a/empty.mp3")).toBeNull();
  });

  it("absolutePathFor throws for a key that would escape the root directory", () => {
    expect(() => store.absolutePathFor("../escape")).toThrow();
    expect(() => store.absolutePathFor("users/../../x")).toThrow();
  });

  it("absolutePathFor accepts an ordinary nested key", () => {
    expect(() => store.absolutePathFor("users/u1/releases/r1/file.mp3")).not.toThrow();
  });
});
