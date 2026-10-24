import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { PlayEventWireSchema, ServerPlaysSummaryPageSchema } from "../../src/server/plays/playsWire";
import { HttpSyncApi, SyncRequestError } from "../../src/server/sync/SyncApi";

// The literal replies of spec/fixtures/play-events/, as the server would send them, through the real HTTP client (#314).
const dir = fileURLToPath(new URL("../../../../spec/fixtures/play-events/", import.meta.url));
const literal = (name: string): string => readFileSync(`${dir}${name}`, "utf8");

let urls: string[];
let bodies: (string | undefined)[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  urls = [];
  bodies = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function reply(text: string, status = 200): void {
  fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
    urls.push(url);
    bodies.push(init?.body as string | undefined);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  });
}

describe("play events fixtures through HttpSyncApi (#398)", () => {
  it("parses valid-summary-with-events.json, the three new fields included", async () => {
    reply(literal("valid-summary-with-events.json"));
    const page = await new HttpSyncApi("http://svc", "tok").playsSummary("2026-10-18", "2026-10-24");
    expect(urls[0]).toBe("http://svc/v1/plays/summary?from=2026-10-18&to=2026-10-24");
    expect(page.tracks[0]).toMatchObject({ lastPlayedAt: 1792841234567, listenedMs: 642000, events: 3, plays: 4, devicePlays: 2 });
    expect(page.tracks[1]).toMatchObject({ lastPlayedAt: null, listenedMs: 0, events: 0 });
    expect(page.allTime[0]).toMatchObject({ lastPlayedAt: 1792841234567, listenedMs: 1830000, events: 8 });
    expect(page.nextCursor).toBeNull();
  });

  it("still parses a summary without the new fields (an older service)", () => {
    const old = { tracks: [{ trackId: "t", releaseId: "r", plays: 1, lastPlayedDay: "2026-10-24" }], allTime: [], nextCursor: null };
    expect(ServerPlaysSummaryPageSchema.safeParse(old).success).toBe(true);
  });

  it("parses the events page and the last page, with their devices and cursors", async () => {
    reply(literal("valid-events-page.json"));
    const api = new HttpSyncApi("http://svc", "tok");
    const first = await api.playEvents(1792000000000, 1793000000000);
    expect(urls[0]).toBe("http://svc/v1/plays/events?from=1792000000000&to=1793000000000");
    expect(first.events).toHaveLength(2);
    expect(first.events[1]).toMatchObject({ source: "spotify", listenedMs: 187000, device: { platform: "ios", current: true } });
    expect(first.nextCursor).toBe("MTc5Mjg0MTYzNDU2NzoyYjlkNGYxYQ");

    reply(literal("valid-events-last-page.json"));
    const last = await api.playEvents(1792000000000, 1793000000000, first.nextCursor!);
    expect(urls[1]).toContain("cursor=MTc5Mjg0MTYzNDU2NzoyYjlkNGYxYQ");
    expect(last.events[0].device.current).toBe(false);
    expect(last.nextCursor).toBeNull();
  });

  it("sends valid-push.json's events as a PUT body the wire schema accepts, and reads the reply", async () => {
    const fixture = JSON.parse(literal("valid-push.json")) as { events: unknown[] };
    const strict = z.object({ events: z.array(PlayEventWireSchema).min(1).max(500) }).strict();
    const events = strict.parse(fixture).events;
    reply(JSON.stringify({ accepted: 2, ignored: 0 }));
    const result = await new HttpSyncApi("http://svc", "tok").pushPlayEvents(events);
    expect(urls[0]).toBe("http://svc/v1/plays/events");
    expect(JSON.parse(bodies[0]!)).toEqual(fixture);
    expect(result).toEqual({ accepted: 2, ignored: 0 });
  });

  it("rejects the invalid push fixtures it can see on its own (unknown key, bad day, not an integer, negative or too large ms)", () => {
    const strict = z.object({ events: z.array(PlayEventWireSchema).min(1).max(500) }).strict();
    for (const name of readdirSync(dir).filter((n) => n.startsWith("invalid-"))) {
      // The future-startedAt fixture is judged by the server's clock; every other one fails the schema.
      if (name === "invalid-started-at-future.json") continue;
      expect(strict.safeParse(JSON.parse(literal(name))).success, name).toBe(false);
    }
  });

  it("a 404 and a 429 on the push surface as SyncRequestError with the status", async () => {
    const api = new HttpSyncApi("http://svc", "tok");
    reply(JSON.stringify({ error: "not found" }), 404);
    await expect(api.pushPlayEvents([])).rejects.toMatchObject({ status: 404 });
    reply(JSON.stringify({ error: "slow down" }), 429);
    await expect(api.pushPlayEvents([])).rejects.toBeInstanceOf(SyncRequestError);
  });
});
