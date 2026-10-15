import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { isDemo } from "../../../../server/demo";
import { errorResponse } from "../../../../server/http/responses";
import { localPlayTotals } from "../../../../server/plays/playTotals";
import type { PlayTotalsResponse } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every track's all-time play count on this Mac, in one response, for the sidebar's play widgets
 * (#154). It reads only `plays.json` and the library list: it never asks the sync service, so
 * opening the sidebar costs the service nothing however big the library is. That also means it
 * shows this Mac's plays only, not other devices'; this endpoint folds into the planned
 * `GET /api/plays/summary` (#200) once other devices' days are merged into the local summary
 * (#202). It takes no input, so nothing user-supplied reaches the store.
 */
export async function GET() {
  if (isDemo()) return NextResponse.json({ tracks: [] } satisfies PlayTotalsResponse);
  try {
    const { settings, library, playStore } = getServices();
    const [counts, releases] = await Promise.all([
      playStore.get(),
      settings.get().then((s) => library.list(s.libraryDir)),
    ]);
    return NextResponse.json(localPlayTotals(counts, new Set(releases.map((r) => r.id))));
  } catch (err) {
    return errorResponse(err);
  }
}
