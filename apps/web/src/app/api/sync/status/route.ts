import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getServices().syncEngine.status();
    return NextResponse.json(status);
  } catch (err) {
    return errorResponse(err);
  }
}
