import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { parseSyncCodeBody } from "../../../../server/http/validation";
import { DEFAULT_SYNC_BASE_URL } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const body = parseSyncCodeBody(rawBody);

    const services = getServices();
    const settings = await services.settings.get();
    const baseUrl = settings.sync?.baseUrl ?? DEFAULT_SYNC_BASE_URL;
    const api = services.syncApiFactory(baseUrl, null);
    await api.requestCode(body.email.trim());

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
