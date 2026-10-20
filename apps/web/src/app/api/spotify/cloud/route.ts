import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { spotifyAvailable } from "../../../../server/spotify/config";
import { SyncAuthError, SyncRequestError, SyncUnavailableError } from "../../../../server/sync/SyncApi";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Maps a failed sync call to a plain sentence; nothing from the service's reply is echoed. */
function failure(err: unknown): NextResponse | null {
  if (err instanceof SyncUnavailableError) return notFound();
  if (err instanceof SyncAuthError) {
    return NextResponse.json({ error: "Sign in to sync again to use online counting." }, { status: 401 });
  }
  if (err instanceof SyncRequestError && err.status === 429) {
    return NextResponse.json({ error: "Too many tries. Try again in a little while." }, { status: 429 });
  }
  return null;
}

/** Online play counting (#307) for Settings: `available` is false when signed out or the service lacks it. */
export async function GET() {
  if (!spotifyAvailable()) return notFound();
  try {
    return NextResponse.json(await getServices().cloudPlays.view());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Start linking (or reconnecting): returns the Spotify address for the browser, only if it is Spotify's own. */
export async function POST() {
  if (!spotifyAvailable()) return notFound();
  try {
    return NextResponse.json(await getServices().cloudPlays.start());
  } catch (err) {
    const mapped = failure(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.message.startsWith("The sync service sent an unexpected Spotify address")) {
      console.error(err);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return errorResponse(err);
  }
}

/** Turn online counting off: deletes the service's Spotify link. */
export async function DELETE() {
  if (!spotifyAvailable()) return notFound();
  try {
    const { cloudPlays } = getServices();
    await cloudPlays.unlink();
    return NextResponse.json(await cloudPlays.view());
  } catch (err) {
    return failure(err) ?? errorResponse(err);
  }
}
