import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { spotifySourceStatus } from "../../../../server/spotify/sourceStatus";
import { isDemo } from "../../../../server/demo";
import { DEMO_SPOTIFY_SOURCE } from "../../../../server/demo/library";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json(DEMO_SPOTIFY_SOURCE);
  try {
    const status = await spotifySourceStatus(getServices());
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
