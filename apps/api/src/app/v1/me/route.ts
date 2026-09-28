import { NextResponse } from "next/server";
import { getServices } from "../../../server/container";
import { requireAuth } from "../../../server/http/authContext";
import { withObservability } from "../../../server/http/observe";
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
