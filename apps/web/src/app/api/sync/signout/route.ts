import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { resetKeepingImports } from "../../../../server/sync/SyncState";
import { demoReadOnly, isDemo } from "../../../../server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (isDemo()) return demoReadOnly();
  try {
    const services = getServices();
    const settings = await services.settings.get();

    if (settings.sync?.deviceToken) {
      try {
        const api = services.syncApiFactory(settings.sync.baseUrl, settings.sync.deviceToken);
        const me = await api.me();
        await api.revokeDevice(me.device.id);
      } catch (err) {
        // Best-effort: if the service is unreachable or the token is already
        // dead, still forget the token locally rather than trapping the user.
        console.error("sync sign-out: failed to revoke device remotely", err);
      }
    }

    await services.settings.update((current) => ({
      ...current,
      sync: current.sync ? { ...current.sync, deviceToken: null, email: null, lastVersion: 0 } : null,
    }));

    // A different account or host signing in later on this Mac must not
    // inherit this account's push bookkeeping or pending phone releases.
    await services.syncState.update(resetKeepingImports);
    await services.syncEngine.forgetFriends();
    // Play counts stay on this Mac; only the record of what was pushed goes, so the next account
    // receives them (#107).
    await services.playStore.resetPushed();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
