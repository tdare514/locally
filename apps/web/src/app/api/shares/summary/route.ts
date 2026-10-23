import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { badRequest } from "../../../../server/http/responses";
import { isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many people a release is still shared with, for the delete confirm. Quietly zero when it can't be asked. */
export async function GET(request: NextRequest) {
  if (isDemo()) return NextResponse.json({ people: 0, link: false });
  const releaseId = request.nextUrl.searchParams.get("releaseId");
  if (!releaseId) return badRequest("Send a releaseId");
  try {
    return NextResponse.json(await getServices().syncEngine.liveShareSummary(releaseId));
  } catch {
    return NextResponse.json({ people: 0, link: false });
  }
}
