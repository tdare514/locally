import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpSyncApi } from "../../src/server/sync/SyncApi";
import { ReceivedShareSchema, SentShareSchema } from "../../src/shared/shares";

// Literal JSON in the shapes of spec/sync.md "Shares (#146)".
const snapshot = {
  kind: "album",
  title: "Night Drive",
  artist: "Okoro",
  year: "2024",
  releaseDate: "2024-05-17",
  genre: "Electronic",
  cover: "cover.jpg",
  coverHash: "a".repeat(64),
  tracks: [
    { id: "t1", title: "Intro", trackNumber: 1, file: "01 - Intro.mp3", bytes: 1234, durationSec: 61 },
    { id: "t2", title: "Song (feat. Bo)", trackNumber: 2, discNumber: 2, file: "02 - Song.mp3", bytes: 99 },
  ],
};
const sent = {
  id: "s1",
  releaseId: "r1",
  trackIds: null,
  visibility: "private",
  allowReshare: false,
  expiresAt: "2026-11-22T10:00:00.000Z",
  revokedAt: null,
  createdAt: "2026-10-23T10:00:00.000Z",
  snapshot,
  recipients: [{ email: "sam@example.com", claimedAt: null }],
  hasLink: false,
  parentShareId: null,
  downloads: 0,
};
const received = {
  id: "s2",
  from: { email: "sam@example.com" },
  trackIds: ["t1"],
  allowReshare: true,
  canReshare: true,
  expiresAt: null,
  createdAt: "2026-10-23T10:00:00.000Z",
  claimedAt: null,
  snapshot,
};

function stubFetch(reply: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("share wire shapes", () => {
  it("parses a literal SentShare and ReceivedShare", () => {
    expect(SentShareSchema.parse(sent).recipients[0].email).toBe("sam@example.com");
    const r = ReceivedShareSchema.parse(received);
    expect(r.from.email).toBe("sam@example.com");
    expect(r.snapshot.releaseDate).toBe("2024-05-17");
    expect(r.snapshot.tracks[1].discNumber).toBe(2);
  });

  it("refuses a share missing a required field", () => {
    const { from: _from, ...broken } = received;
    void _from;
    expect(ReceivedShareSchema.safeParse(broken).success).toBe(false);
  });

  it("lists received shares through GET /v1/shares?role=received", async () => {
    const calls = stubFetch({ shares: [received], nextCursor: null });
    const api = new HttpSyncApi("http://api.test", "tok");
    const page = await api.listReceivedShares(null, 100);
    expect(page.shares[0].id).toBe("s2");
    expect(calls[0].url).toBe("http://api.test/v1/shares?role=received&limit=100");
  });

  it("reads a create reply with notOnLocally and a link", async () => {
    const calls = stubFetch({ share: sent, notOnLocally: ["ghost@example.com"], link: "http://api.test/s/abc" }, 201);
    const api = new HttpSyncApi("http://api.test", "tok");
    const reply = await api.createShare({
      releaseId: "r1",
      recipients: ["sam@example.com", "ghost@example.com"],
      visibility: "public",
      allowReshare: false,
      expiresInDays: 30,
    });
    expect(reply.notOnLocally).toEqual(["ghost@example.com"]);
    expect(reply.link).toBe("http://api.test/s/abc");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body)).expiresInDays).toBe(30);
  });

  it("revokes with DELETE /v1/shares/:id", async () => {
    const calls = stubFetch({ ok: true });
    await new HttpSyncApi("http://api.test", "tok").revokeShare("s1");
    expect(calls[0].url).toBe("http://api.test/v1/shares/s1");
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("claims, hides and asks for a file on the right routes", async () => {
    const calls = stubFetch({ claimedAt: "2026-10-23T10:00:00.000Z" });
    const api = new HttpSyncApi("http://api.test", "tok");
    await api.claimShare("s2");
    await api.hideShare("s2");
    await api.shareFileUrl("s2", "01 - Intro.mp3");
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "POST http://api.test/v1/shares/s2/claim",
      "POST http://api.test/v1/shares/s2/hide",
      "GET http://api.test/v1/shares/s2/files/01%20-%20Intro.mp3",
    ]);
  });

  it("says why an adopted release can't be shared (409)", async () => {
    stubFetch({ error: "adopted" }, 409);
    await expect(
      new HttpSyncApi("http://api.test", "tok").createShare({
        releaseId: "r1",
        recipients: [],
        visibility: "private",
        allowReshare: false,
        expiresInDays: null,
      })
    ).rejects.toThrow(/can't share it/);
  });
});
