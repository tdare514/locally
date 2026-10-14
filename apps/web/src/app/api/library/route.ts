import { NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { isDemo } from "../../../server/demo";
import { DEMO_RELEASES } from "../../../server/demo/library";
import { errorResponse } from "../../../server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json({ version: 1, releases: DEMO_RELEASES });
  try {
    const services = getServices();
    const settings = await services.settings.get();
    const releases = await services.library.list(settings.libraryDir);
    return NextResponse.json({ version: 1, releases });
  } catch (err) {
    return errorResponse(err);
  }
}
