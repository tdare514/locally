import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { demoReadOnly, isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scan the saved adopt folders again and return the new proposal (#245). */
export async function POST() {
  if (isDemo()) return demoReadOnly();
  try {
    return NextResponse.json(await getServices().adopt.scan());
  } catch (err) {
    return errorResponse(err);
  }
}
