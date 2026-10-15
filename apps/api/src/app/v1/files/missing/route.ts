import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { withObservability } from "../../../../server/http/observe";
import { consumeDeviceAndUser } from "../../../../server/ratelimit/consumeDeviceAndUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withObservability("/v1/files/missing", async (request, obs) => {
  const services = await getServices();
  const { user, device } = await requireAuth(request, services.auth, obs);
  // A Blob listing is a priced call and this is a repair path, so it is capped per device and per account.
  await consumeDeviceAndUser(
    { byDevice: services.rateLimiters.missingFilesByDevice, byUser: services.rateLimiters.missingFilesByUser },
    { deviceId: device.id, userId: user.id },
    "Too many missing-files checks. Try again later."
  );

  return NextResponse.json(await services.files.missingFiles(user.id));
});
