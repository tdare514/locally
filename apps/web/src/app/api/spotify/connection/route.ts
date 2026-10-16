import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { spotifyAvailable } from "../../../../server/spotify/config";
import { spotifyConnectionStatus } from "../../../../server/spotify/connectionStatus";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Connection state for Settings. Never carries a token. 404 when the connection is off (#239). */
export async function GET() {
  if (!spotifyAvailable()) return notFound();
  try {
    return NextResponse.json(await spotifyConnectionStatus(getServices()));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Disconnect: stop any pending sign-in and delete the stored tokens. */
export async function DELETE() {
  if (!spotifyAvailable()) return notFound();
  try {
    const services = getServices();
    await services.spotifyAuth.disconnect();
    services.spotifyClient.clearError();
    // The cached playlist names go with the connection (#212).
    await services.playlistIndex.clear();
    return NextResponse.json(await spotifyConnectionStatus(services));
  } catch (err) {
    return errorResponse(err);
  }
}
