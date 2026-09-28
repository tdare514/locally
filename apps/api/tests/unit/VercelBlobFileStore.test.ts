import { beforeEach, describe, expect, it, vi } from "vitest";

const issueSignedToken = vi.fn(async () => "signed-token");
const presignUrl = vi.fn(async () => ({ presignedUrl: "https://blob.example/presigned" }));
const del = vi.fn(async () => undefined);

vi.mock("@vercel/blob", () => ({ issueSignedToken, presignUrl, del }));

const { VercelBlobFileStore, blobPathname } = await import("../../src/server/files/VercelBlobFileStore");

describe("blobPathname", () => {
  it("leaves a printable-ASCII key untouched", () => {
    const key = "users/u1/releases/r1/01 - Track (live).mp3";
    expect(blobPathname(key)).toBe(key);
  });

  it("writes each byte outside printable ASCII, and a literal ~, as ~XX", () => {
    // `@vercel/blob` decodes its own signed token with `atob`, which turns a
    // UTF-8 curly apostrophe into three Latin-1 characters; the SDK then
    // rejects the token it just issued. Percent-escapes fail too: Blob
    // normalises them in the presigned URL and answers 403. So the path the
    // SDK sees must be ASCII with no `%`.
    expect(blobPathname("users/u1/releases/r1/01 - It’s Over.mp3")).toBe(
      "users/u1/releases/r1/01 - It~E2~80~99s Over.mp3"
    );
    expect(blobPathname("a/tab\there.mp3")).toBe("a/tab~09here.mp3");
    expect(blobPathname("a/x~y.mp3")).toBe("a/x~7Ey.mp3");
    // Astral code points are encoded whole, not as two lone surrogates.
    expect(blobPathname("a/🎵.mp3")).toBe("a/~F0~9F~8E~B5.mp3");
    // A literal % is printable ASCII and passes through, as it did before.
    expect(blobPathname("a/100%.mp3")).toBe("a/100%.mp3");
  });
});

describe("VercelBlobFileStore", () => {
  const key = "users/u1/releases/r1/01 - It’s Over.mp3";
  const encoded = "users/u1/releases/r1/01 - It~E2~80~99s Over.mp3";
  let store: InstanceType<typeof VercelBlobFileStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new VercelBlobFileStore("rw-token");
  });

  it("signs and presigns uploads with the encoded pathname", async () => {
    const ticket = await store.createUpload({ key, bytes: 123, contentType: "audio/mpeg" });
    expect(ticket).toEqual({
      url: "https://blob.example/presigned",
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg" },
    });
    expect(issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({ pathname: encoded, operations: ["put"] }));
    expect(presignUrl).toHaveBeenCalledWith("signed-token", expect.objectContaining({ pathname: encoded, operation: "put" }));
  });

  it("signs and presigns downloads with the encoded pathname", async () => {
    const ticket = await store.createDownload(key);
    expect(ticket.url).toBe("https://blob.example/presigned");
    expect(issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({ pathname: encoded, operations: ["get"] }));
    expect(presignUrl).toHaveBeenCalledWith("signed-token", expect.objectContaining({ pathname: encoded, operation: "get" }));
  });

  it("deletes by the encoded pathname (batched through deleteMany)", async () => {
    await store.delete(key);
    expect(del).toHaveBeenCalledWith([encoded], { token: "rw-token" });
  });

  it("deleteMany encodes every key and calls del once", async () => {
    await store.deleteMany([key, "users/u1/releases/r1/ascii.mp3"]);
    expect(del).toHaveBeenCalledWith(
      [encoded, "users/u1/releases/r1/ascii.mp3"],
      { token: "rw-token" }
    );
  });

  it("deleteMany is a no-op on an empty list", async () => {
    await store.deleteMany([]);
    expect(del).not.toHaveBeenCalled();
  });
});
