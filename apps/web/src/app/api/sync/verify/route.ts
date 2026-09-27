import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { toSettingsResponse } from "../../../../server/config/settingsView";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { DEFAULT_SYNC_BASE_URL } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown };
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return badRequest("A valid email is required");
    }
    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      return badRequest("The six-digit code is required");
    }

    const services = getServices();
    const settings = await services.settings.get();
    const baseUrl = settings.sync?.baseUrl ?? DEFAULT_SYNC_BASE_URL;
    const api = services.syncApiFactory(baseUrl, null);
    const result = await api.verifyCode(body.email.trim(), body.code.trim(), os.hostname(), "mac");

    const updated = await services.settings.set({
      ...settings,
      sync: { baseUrl, deviceToken: result.token, email: result.user.email, lastVersion: 0 },
    });

    // Kick off a reconcile right away so the UI doesn't wait for the next
    // 30s poll to see the first push/pull; errors land on the status object.
    void services.syncEngine.reconcile();

    return NextResponse.json(toSettingsResponse(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
