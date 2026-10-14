import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { errorResponse } from "../../../server/http/responses";
import { parseImportMeta } from "../../../server/http/validation";
import { demoReadOnly, isDemo } from "../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const form = await request.formData();
    const { meta, audioFiles, coverFile } = await parseImportMeta(form);
    const release = await getServices().releases.import(meta, coverFile, audioFiles);
    return NextResponse.json(release);
  } catch (err) {
    return errorResponse(err);
  }
}
