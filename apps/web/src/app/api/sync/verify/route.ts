import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { toSettingsResponse } from "../../../../server/config/settingsView";
import { errorResponse } from "../../../../server/http/responses";
import { parseSyncVerifyBody } from "../../../../server/http/validation";
import { DEFAULT_SYNC_BASE_URL } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const body = parseSyncVerifyBody(rawBody);

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
