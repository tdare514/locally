import { NextResponse } from "next/server";
import { getServices } from "../../../../../server/container";
import { spotifySourceStatus } from "../../../../../server/spotify/sourceStatus";
import { errorResponse } from "../../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const services = getServices();
    const current = await services.settings.get();
    await services.settings.set({ ...current, spotifySourceDismissed: true });
    const status = await spotifySourceStatus(services);
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
