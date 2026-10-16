import { beforeEach, describe, expect, it, vi } from "vitest";

const issueSignedToken = vi.fn(async () => "signed-token");
const presignUrl = vi.fn(async () => ({ presignedUrl: "https://blob.example/presigned" }));
const del = vi.fn(async () => undefined);

interface ListPage {
  blobs: Array<{ pathname: string }>;
  cursor?: string;
  hasMore: boolean;
}
interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
  token?: string;
}
const list = vi.fn<(options: ListOptions) => Promise<ListPage>>(async () => ({ blobs: [], hasMore: false }));

vi.mock("@vercel/blob", () => ({ issueSignedToken, presignUrl, del, list }));

const { VercelBlobFileStore, blobPathname, keyFromBlobPathname } = await import(
  "../../src/server/files/VercelBlobFileStore"
);

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

describe("keyFromBlobPathname", () => {
  it("undoes blobPathname for ASCII, accents, curly quotes, a literal ~ and astral code points", () => {
    const keys = [
      "users/u1/releases/r1/01 - Track (live).mp3",
      "users/u1/releases/r1/01 - It’s Over.mp3",
      "users/u1/releases/r1/Café Tacvba - Ré.m4a",
      "users/u1/releases/r1/x~y~7E.mp3",
      "users/u1/releases/r1/~.jpg",
      "users/u1/releases/r1/🎵 日本語.mp3",
      "users/u1/releases/r1/100%.mp3",
    ];
    for (const key of keys) expect(keyFromBlobPathname(blobPathname(key))).toBe(key);
  });

  it("leaves a ~ that is not followed by two hex digits alone", () => {
    expect(keyFromBlobPathname("a/~zz.mp3")).toBe("a/~zz.mp3");
    expect(keyFromBlobPathname("a/~4.mp3")).toBe("a/~4.mp3");
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
    expect(presignUrl).toHaveBeenCalledWith(
      "signed-token",
      expect.objectContaining({ pathname: encoded, operation: "put", addRandomSuffix: false, allowOverwrite: true })
    );
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

  describe("listKeys", () => {
    const prefix = "users/u1/releases/";

    /** Serves `pages` by cursor, so the mock is stateless: page "" is the first call (no cursor). */
    function servePages(pages: Record<string, ListPage>): void {
      list.mockImplementation(async ({ cursor }) => {
        const page = pages[cursor ?? ""];
        if (!page) throw new Error(`unexpected cursor ${cursor}`);
        return page;
      });
    }

    async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
      const keys: string[] = [];
      for await (const key of iterable) keys.push(key);
      return keys;
    }

    it("follows the cursor across more than one page until hasMore is false", async () => {
      servePages({
        "": { blobs: [{ pathname: `${prefix}r1/a.mp3` }, { pathname: `${prefix}r1/b.mp3` }], cursor: "c1", hasMore: true },
        c1: { blobs: [{ pathname: `${prefix}r2/c.mp3` }], cursor: "c2", hasMore: true },
        c2: { blobs: [{ pathname: `${prefix}r3/d.jpg` }], hasMore: false },
      });

      expect(await collect(store.listKeys(prefix))).toEqual([
        `${prefix}r1/a.mp3`,
        `${prefix}r1/b.mp3`,
        `${prefix}r2/c.mp3`,
        `${prefix}r3/d.jpg`,
      ]);
      expect(list).toHaveBeenCalledTimes(3);
      expect(list.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, "c1", "c2"]);
      for (const [options] of list.mock.calls) {
        expect(options).toMatchObject({ prefix, limit: 1000, token: "rw-token" });
      }
    });

    it("makes one call and yields nothing for an empty prefix", async () => {
      servePages({ "": { blobs: [], hasMore: false } });
      expect(await collect(store.listKeys(prefix))).toEqual([]);
      expect(list).toHaveBeenCalledTimes(1);
    });

    it("fetches pages lazily: a caller that stops early does not pay for the next page", async () => {
      servePages({
        "": { blobs: [{ pathname: `${prefix}r1/a.mp3` }], cursor: "c1", hasMore: true },
        c1: { blobs: [{ pathname: `${prefix}r1/b.mp3` }], hasMore: false },
      });
      for await (const key of store.listKeys(prefix)) {
        expect(key).toBe(`${prefix}r1/a.mp3`);
        break;
      }
      expect(list).toHaveBeenCalledTimes(1);
    });

    it("sends the encoded prefix and decodes listed pathnames back to storage keys", async () => {
      const unicodePrefix = "users/u1/releases/r1/01 - It’s";
      servePages({ "": { blobs: [{ pathname: "users/u1/releases/r1/01 - It~E2~80~99s Over.mp3" }], hasMore: false } });

      expect(await collect(store.listKeys(unicodePrefix))).toEqual([key]);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: "users/u1/releases/r1/01 - It~E2~80~99s" }));
    });

    it("stops rather than looping when a page says hasMore but sends no cursor", async () => {
      servePages({ "": { blobs: [{ pathname: `${prefix}r1/a.mp3` }], hasMore: true } });
      expect(await collect(store.listKeys(prefix))).toEqual([`${prefix}r1/a.mp3`]);
      expect(list).toHaveBeenCalledTimes(1);
    });

    it("lets a listing error reach the caller", async () => {
      list.mockImplementation(async () => {
        throw new Error("blob unavailable");
      });
      await expect(collect(store.listKeys(prefix))).rejects.toThrow("blob unavailable");
    });
  });
});
