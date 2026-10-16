import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { isDemo } from "../../../../server/demo";
import { errorResponse } from "../../../../server/http/responses";
import { loadPlaysSummary } from "../../../../server/plays/playsSummary";
import type { PlaysSummaryResponse } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** This Mac's plays in `from`..`to` (local dates) and all time, for the releases in the library, from `plays.json`, plus other devices' plays from the sync service when signed in (#200, #202). */
export async function GET(request: NextRequest) {
  if (isDemo()) return NextResponse.json({ tracks: [], allTime: [], countingSince: null, includesOtherDevices: false } satisfies PlaysSummaryResponse);
  try {
    const { searchParams } = request.nextUrl;
    const { settings, library, playStore, syncApiFactory } = getServices();
    const deps = { settings, library, playStore, syncApiFactory, now: Date.now };
    return NextResponse.json(await loadPlaysSummary(deps, searchParams.get("from"), searchParams.get("to")));
  } catch (err) {
    return errorResponse(err);
  }
}
