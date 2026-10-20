import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The last scan's proposal, or null when there is none (#245). */
export async function GET() {
  if (isDemo()) return demoReadOnly();
  try {
    return NextResponse.json({ proposal: await getServices().adopt.proposal() });
  } catch (err) {
    return errorResponse(err);
  }
}
