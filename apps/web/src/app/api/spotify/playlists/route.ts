import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "../../../../server/container";
import { spotifyAvailable } from "../../../../server/spotify/config";
import { badRequest, errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Spotify playlists each track of one release is in (#212), from the cache. Kicks a
 * background refresh when the cache is stale. 404 when the connection is off; never a token.
 */
export async function GET(request: NextRequest) {
  if (!spotifyAvailable()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const releaseId = request.nextUrl.searchParams.get("releaseId");
  if (!releaseId) return badRequest("releaseId is required");
  try {
    return NextResponse.json(await getServices().playlistIndex.forRelease(releaseId));
  } catch (err) {
    return errorResponse(err);
  }
}
