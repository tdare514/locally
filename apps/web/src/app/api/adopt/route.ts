import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { errorResponse } from "../../../server/http/responses";
import { parseAdoptBody } from "../../../server/http/validation";
import { demoReadOnly, isDemo } from "../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adopt the accepted groups of the stored proposal, in place (#245). */
export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const { keys } = parseAdoptBody(await request.json().catch(() => null));
    const result = await getServices().adopt.adopt(keys);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
