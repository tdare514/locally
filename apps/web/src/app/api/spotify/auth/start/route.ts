import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { spotifyAvailable } from "../../../../../server/spotify/config";
import { SpotifyAuthError } from "../../../../../server/spotify/SpotifyAuth";
import { errorResponse } from "../../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a Spotify sign-in: opens the loopback listener and returns the URL for the browser. */
export async function POST() {
  if (!spotifyAvailable()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const services = getServices();
    services.spotifyClient.clearError();
    return NextResponse.json(await services.spotifyAuth.start());
  } catch (err) {
    if (err instanceof SpotifyAuthError || (err as Error)?.name === "SpotifyAuthError") {
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    return errorResponse(err);
  }
}
