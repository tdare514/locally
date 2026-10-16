import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { withObservability } from "../../../../server/http/observe";
import { consumeDeviceAndUser } from "../../../../server/ratelimit/consumeDeviceAndUser";
import type { ResyncRequestResponse } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withObservability("/v1/files/resync-request", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);
  await consumeDeviceAndUser(
    { byDevice: services.rateLimiters.resyncRequestByDevice, byUser: services.rateLimiters.resyncRequestByUser },
    { deviceId: device.id, userId: user.id },
    "Too many resync requests. Try again later."
  );

  const response: ResyncRequestResponse = { resyncRequestedAt: await services.files.requestResync(user.id) };
  return NextResponse.json(response);
});
