import { NextResponse } from "next/server";
import { readSettings } from "../../../lib/settings";
import { readLibrary } from "../../../lib/library";
import { errorResponse } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readSettings();
    const library = await readLibrary(settings.libraryDir);
    return NextResponse.json(library);
  } catch (err) {
    return errorResponse(err);
  }
}
