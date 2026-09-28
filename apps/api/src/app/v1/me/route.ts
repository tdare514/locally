import { NextResponse } from "next/server";
import type { Services } from "../../../server/container";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { runAfterResponse } from "../../../server/http/afterResponse";
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

  const [usedBytes, limitBytes, deviceList] = await Promise.all([
    services.quota.usedBytes(user.id),
    services.quota.limitBytes(user.id),
    services.auth.listDevices(user.id),
  ]);

  const response: MeResponse = {
    user,
    device: { id: device.id, name: device.name },
    quota: { usedBytes, limitBytes },
    devices: deviceList.devices,
    devicesHasMore: deviceList.hasMore,
  };
  return NextResponse.json(response);
});

/**
 * Drain queued blobs after the response. Failures are logged and left for
 * the daily cron; never surfaced as a 500 on the delete.
 */
function drainInBackground(services: Services, storageKeys: string[], obs: RequestObs): void {
  runAfterResponse(async () => {
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
  });
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
  drainInBackground(services, result.queuedKeys, obs);

  return NextResponse.json({ ok: true });
});
