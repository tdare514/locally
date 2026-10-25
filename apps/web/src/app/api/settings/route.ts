import { NextRequest, NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { homeDir } from "../../../server/config/paths";
import { makeRootProbe, suggestedAdoptRoot } from "../../../server/config/adoptRoots";
import { planSettingsUpdate } from "../../../server/config/settingsUpdate";
import { toSettingsResponse } from "../../../server/config/settingsView";
import { badRequest, errorResponse } from "../../../server/http/responses";
import { parseSettingsPutBody } from "../../../server/http/validation";
import { resetKeepingImports } from "../../../server/sync/SyncState";
import { demoReadOnly, isDemo } from "../../../server/demo";
import { DEMO_SETTINGS_RESPONSE } from "../../../server/demo/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDemo()) return NextResponse.json(DEMO_SETTINGS_RESPONSE);
  try {
    const services = getServices();
    const settings = await services.settings.get();
    const suggestion = suggestedAdoptRoot(homeDir(), settings.adoptRoots ?? [], makeRootProbe());
    return NextResponse.json(toSettingsResponse(settings, suggestion));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  if (isDemo()) return demoReadOnly();
  try {
    const rawBody = await request.json();
    const body = parseSettingsPutBody(rawBody);
    const services = getServices();
    const probe = makeRootProbe();
    // Planned from the settings as they are at write time, so a concurrent change isn't overwritten.
    let rejection = null as string | null;
    let resetSyncState = false;
    const settings = await services.settings.update((current) => {
      const plan = planSettingsUpdate(current, body, homeDir(), probe);
      if (!plan.ok) {
        rejection = plan.error;
        return null;
      }
      resetSyncState = plan.resetSyncState;
      return plan.settings;
    });
    if (rejection !== null) return badRequest(rejection);
    if (resetSyncState) {
      await services.syncState.update(resetKeepingImports);
      await services.syncEngine.forgetFriends();
    }
    // After the settings are saved, as sign-out does it: a new host is a new account, and its play
    // counts were never pushed there (#107).
    if (resetSyncState) {
      await services.playStore.resetPushed();
      await services.playEvents.resetPushed();
    }
    services.playTracker.setEnabled(settings.trackPlays === true);
    return NextResponse.json(toSettingsResponse(settings, suggestedAdoptRoot(homeDir(), settings.adoptRoots ?? [], probe)));
  } catch (err) {
    return errorResponse(err);
  }
}
