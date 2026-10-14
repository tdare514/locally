import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { isDemo } from "../../../../server/demo";
import { DEMO_SYNC_STATUS } from "../../../../server/demo/library";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json(DEMO_SYNC_STATUS);
  try {
    const status = await getServices().syncEngine.status();
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
