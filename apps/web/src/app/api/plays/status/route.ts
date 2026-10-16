import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { isDemo } from "../../../../server/demo";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json({ status: "off", source: "this-mac", fallingBack: false });
  try {
    const { playTracker, nowPlaying } = getServices();
    return NextResponse.json({
      status: playTracker.status(),
      source: nowPlaying.currentSource(),
      fallingBack: nowPlaying.fallingBack(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
