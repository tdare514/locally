import { after, NextResponse } from "next/server";
import type { Services } from "../../../server/container";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import type { RequestObs } from "../../../server/http/observe";
import { withObservability } from "../../../server/http/observe";
import { parseJsonBody } from "../../../server/http/validation";
import { deleteMeRequestSchema } from "../../../shared/types";
import type { MeResponse } from "../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withObservability("/v1/me", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);

  const [usedBytes, limitBytes, devices] = await Promise.all([
    services.quota.usedBytes(user.id),
    services.quota.limitBytes(user.id),
    services.auth.listDevices(user.id),
  ]);

  const response: MeResponse = {
    user,
    device: { id: device.id, name: device.name },
    quota: { usedBytes, limitBytes },
    devices,
  };
  return NextResponse.json(response);
});

/**
 * Deletes the account, then drains its queued blobs right after via
 * `after()`. `after()` needs a Next request scope, which a real deployed
 * request has but a direct handler call (a test, or any future non-Next
 * caller) doesn't — fall back to draining inline rather than silently
 * dropping the pass; the cron is the guarantee either way, and a failure
 * here is logged and left for it.
 */
async function drainInBackground(services: Services, storageKeys: string[], obs: RequestObs): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      await services.cleanup.drainPendingDeletes(storageKeys);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "account_delete_drain_failed",
          requestId: obs.requestId,
          queuedKeys: storageKeys.length,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  try {
    after(run);
  } catch {
    await run();
  }
}

export const DELETE = withObservability("/v1/me", async (request, obs) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const body = await parseJsonBody(request, deleteMeRequestSchema);

  const result = await services.account.deleteAccount(user.id, body.email);
  console.log(
    JSON.stringify({
      level: "info",
      event: "account_deleted",
      requestId: obs.requestId,
      userId: user.id,
      deletedDevices: result.deletedDevices,
      deletedReleases: result.deletedReleases,
      deletedFiles: result.deletedFiles,
    })
  );
  await drainInBackground(services, result.queuedKeys, obs);

  return NextResponse.json({ ok: true });
});
