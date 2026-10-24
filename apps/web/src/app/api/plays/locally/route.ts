import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../../server/container";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { RETENTION_DAYS, localDay } from "../../../../server/plays/playDays";
import { MAX_EVENT_LISTENED_MS } from "../../../../server/plays/PlayEventStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Most ms the clock may be ahead of the server's before `startedAt` is refused (`spec/sync.md`, "Play events"). */
const SKEW_MS = 24 * 60 * 60 * 1000;

// `startedAt` and `listenedMs` (#398) are optional and come together: without them nothing but the count is written.
const countSchema = z
  .object({
    releaseId: z.uuid(),
    trackId: z.uuid(),
    startedAt: z.number().int().min(0).optional(),
    listenedMs: z.number().int().min(0).max(MAX_EVENT_LISTENED_MS).optional(),
  })
  .strict()
  .refine((b) => (b.startedAt === undefined) === (b.listenedMs === undefined), "startedAt and listenedMs go together");
const nowSchema = z.object({ trackId: z.uuid().nullable() }).strict();

/**
 * A play in Locally's own player counted in the window (#338): the player applies `PlayCounter`'s rule and
 * reports each counted play once. It counts only while "Count plays" (`trackPlays`) is on, else answers 204. The release must hold the track. It goes into `plays.json` under the
 * "locally" source, with today's local date, and is pushed like any other count.
 */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const body = countSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest("releaseId and trackId must be UUIDs; startedAt and listenedMs must be integers in ms, given together");
    const { startedAt, listenedMs } = body.data;
    if (startedAt !== undefined && (startedAt > Date.now() + SKEW_MS || startedAt < Date.now() - RETENTION_DAYS * 86_400_000)) {
      return badRequest("startedAt must be within the last 400 days and no more than a day ahead");
    }
    const { settings, library, playStore, playEvents } = getServices();
    const current = await settings.get();
    // "Count plays" off means nothing is counted, in Spotify or in Locally (owner, 23 Oct). The server decides.
    if (current.trackPlays !== true) return new NextResponse(null, { status: 204 });
    const { libraryDir } = current;
    const release = await library.find(libraryDir, body.data.releaseId);
    if (!release?.tracks.some((t) => t.id === body.data.trackId)) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }
    if (startedAt !== undefined && listenedMs !== undefined) {
      // One event per session, keyed by (trackId, startedAt): the first report adds it and counts the play, later
      // ones only raise its listened time (#398).
      const created = await playEvents.record({ releaseId: release.id, trackId: body.data.trackId, source: "locally", startedAt, listenedMs });
      if (created) await playStore.increment(body.data.trackId, release.id, localDay(Date.now()), "locally");
      return NextResponse.json({ ok: true });
    }
    await playStore.increment(body.data.trackId, release.id, localDay(Date.now()), "locally");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * The track Locally's player is playing now, or null once it stops. The window repeats it every few seconds
 * while playing and it lapses after 15 s, so the Spotify tracker can ignore a read of the same track.
 */
export async function PUT(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const body = nowSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest("trackId must be a UUID or null");
    const { settings, locallyPlaying } = getServices();
    // Counting off: nothing is tracked, so the Spotify tracker has nothing to guard against either.
    if ((await settings.get()).trackPlays !== true) return new NextResponse(null, { status: 204 });
    locallyPlaying.set(body.data.trackId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
