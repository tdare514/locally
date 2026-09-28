import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { errorResponse } from "../../../../server/http/responses";
import { emptySyncState } from "../../../../server/sync/SyncState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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

    await services.settings.set({
      ...settings,
      sync: settings.sync ? { ...settings.sync, deviceToken: null, email: null, lastVersion: 0 } : null,
    });

    // A different account or host signing in later on this Mac must not
    // inherit this account's push bookkeeping or pending phone releases.
    await services.syncState.set(emptySyncState());

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
