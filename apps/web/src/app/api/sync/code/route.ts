import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { DEFAULT_SYNC_BASE_URL } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return badRequest("A valid email is required");
    }

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
