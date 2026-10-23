import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether this Mac is signed in to sync, and whether the service has public links on (`GET /v1/me`). */
export async function GET() {
  if (isDemo()) return NextResponse.json({ signedIn: false, publicSharesEnabled: false });
  try {
    return NextResponse.json(await getServices().syncEngine.shareOptions());
  } catch (err) {
    return errorResponse(err);
  }
}
