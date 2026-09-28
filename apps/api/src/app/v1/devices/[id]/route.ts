import { NextResponse } from "next/server";
import { getServices } from "../../../../server/container";
import { requireAuth } from "../../../../server/http/authContext";
import { parseParam } from "../../../../server/http/validation";
import { withObservability } from "../../../../server/http/observe";
import { uuidSchema } from "../../../../shared/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export const DELETE = withObservability("/v1/devices/[id]", async (request, obs, { params }: Params) => {
  const services = await getServices();
  const { user } = await requireAuth(request, services.auth, obs);
  const { id } = await params;
  const deviceId = parseParam(id, uuidSchema);

  await services.auth.revokeDevice(user.id, deviceId);
  return NextResponse.json({ ok: true });
});
