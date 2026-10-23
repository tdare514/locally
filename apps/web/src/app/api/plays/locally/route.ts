import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../../server/container";
import { demoReadOnly, isDemo } from "../../../../server/demo";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { localDay } from "../../../../server/plays/playDays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const countSchema = z.object({ releaseId: z.uuid(), trackId: z.uuid() }).strict();
const nowSchema = z.object({ trackId: z.uuid().nullable() }).strict();

/**
 * A play in Locally's own player counted in the window (#338): the player applies `PlayCounter`'s rule and
 * reports each counted play once. The release must hold the track. It goes into `plays.json` under the
 * "locally" source, with today's local date, and is pushed like any other count.
 */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const body = countSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return badRequest("releaseId and trackId must be UUIDs");
    const { settings, library, playStore } = getServices();
    const { libraryDir } = await settings.get();
    const release = await library.find(libraryDir, body.data.releaseId);
    if (!release?.tracks.some((t) => t.id === body.data.trackId)) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
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
    getServices().locallyPlaying.set(body.data.trackId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
