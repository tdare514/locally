import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { homeDir } from "../../../server/config/paths";
import { planSettingsUpdate } from "../../../server/config/settingsUpdate";
import { toSettingsResponse } from "../../../server/config/settingsView";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { parseSettingsPutBody } from "../../../server/http/validation";
import { emptySyncState } from "../../../server/sync/SyncState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getServices().settings.get();
    return NextResponse.json(toSettingsResponse(settings));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const body = parseSettingsPutBody(rawBody);
    const services = getServices();
    const current = await services.settings.get();

    const plan = planSettingsUpdate(current, body, homeDir());
    if (!plan.ok) return badRequest(plan.error);
    if (plan.resetSyncState) await services.syncState.set(emptySyncState());
    const settings = await services.settings.set(plan.settings);
    return NextResponse.json(toSettingsResponse(settings));
  } catch (err) {
    return errorResponse(err);
  }
}
