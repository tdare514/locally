import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { badRequest, errorResponse } from "../../../../server/http/responses";
import { toSettingsResponse } from "../../../../server/config/settingsView";
import { emptySyncState } from "../../../../server/sync/SyncState";
import { SyncAuthError } from "../../../../server/sync/SyncApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const services = getServices();
    const settings = await services.settings.get();

    if (!settings.sync?.deviceToken) {
      return badRequest("Not signed in");
    }

    let alreadySignedOut = false;
    try {
      const api = services.syncApiFactory(settings.sync.baseUrl, settings.sync.deviceToken);
      await api.deleteAccount(settings.sync.email ?? "");
    } catch (err) {
      if (err instanceof SyncAuthError) {
        // The account is already gone or this device was revoked; treat it
        // like a successful delete and clear local state anyway.
        alreadySignedOut = true;
      } else {
        throw err;
      }
    }

    const updated = await services.settings.set({
      ...settings,
      sync: { ...settings.sync, deviceToken: null, email: null, lastVersion: 0 },
    });

    // Same reasoning as sign-out: this device's push bookkeeping and pending
    // phone releases belong to the now-deleted account.
    await services.syncState.set(emptySyncState());

    const body = toSettingsResponse(updated);
    return NextResponse.json(alreadySignedOut ? { ...body, ok: true, alreadySignedOut: true } : { ...body, ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
