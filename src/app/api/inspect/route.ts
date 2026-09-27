import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { errorResponse } from "../../../server/http/responses";
import { parseInspectAudio } from "../../../server/http/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const audioFiles = parseInspectAudio(form);
    const files = await getServices().inspect.inspect(audioFiles);
    return NextResponse.json({ files });
  } catch (err) {
    return errorResponse(err);
  }
}
