import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServices } from "../../../server/container";
import { isDemo } from "../../../server/demo";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { loadReleasePlays } from "../../../server/plays/releasePlays";
import type { ReleasePlaysResponse } from "../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const releaseIdSchema = z.uuid();

/** Merged play counts for one release's tracks: this Mac and, when signed in, the sync service (#107). */
export async function GET(request: NextRequest) {
  if (isDemo()) return NextResponse.json({ tracks: [] } satisfies ReleasePlaysResponse);
  try {
    const releaseId = releaseIdSchema.safeParse(request.nextUrl.searchParams.get("releaseId"));
    if (!releaseId.success) return badRequest("releaseId must be a UUID");
    const { settings, playStore, syncApiFactory } = getServices();
    // `os.hostname()` is the device name the sync client sends at sign-in (api/sync/verify).
    const deps = { settings, playStore, syncApiFactory, deviceName: os.hostname() };
    return NextResponse.json(await loadReleasePlays(deps, releaseId.data));
  } catch (err) {
    return errorResponse(err);
  }
}
