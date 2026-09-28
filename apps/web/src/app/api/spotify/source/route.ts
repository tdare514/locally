import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { spotifySourceStatus } from "../../../../server/spotify/sourceStatus";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await spotifySourceStatus(getServices());
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
