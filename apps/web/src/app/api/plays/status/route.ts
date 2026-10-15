import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { isDemo } from "../../../../server/demo";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json({ status: "off" });
  try {
    return NextResponse.json({ status: getServices().playTracker.status() });
  } catch (err) {
    return errorResponse(err);
  }
}
